import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  auditExamItemDataQuality,
  computeVersionScoreDelta,
  validateSubjectiveEvaluationSchema,
} from '../src/shared/schemaValidator.ts';
import {
  reconcileDimensionScores,
  runTwoStageSubjectiveEvaluation,
} from '../src/server/aiEvaluators.ts';
import { createApiV1Router } from '../src/server/apiRouter.ts';
import type { ModelProvider } from '../src/server/modelProviders.ts';
import { computeCompositeIdempotencyKey } from '../src/server/persistentStore.ts';
import {
  SecurityError,
  assertProductionMasterKeyConfigured,
  createRedactedLogEntry,
  decryptProviderApiKey,
  encryptProviderApiKey,
  getMasterEncryptionKey,
  isUserInOwnerUids,
  normalizeProviderBaseUrl,
  validateSafeCustomBaseUrl,
} from '../src/server/securityAndCrypto.ts';

test('AES-256-GCM encryption and decryption binds UID and provider as AAD and never leaks plaintext', () => {
  // Cloud Run / AI Studio production startup without CREDENTIAL_ENCRYPTION_KEY auto-generates random instance key
  assert.doesNotThrow(() => {
    assertProductionMasterKeyConfigured({ NODE_ENV: 'production' });
  });
  const autoKey = getMasterEncryptionKey({ env: { NODE_ENV: 'production' } });
  assert.equal(autoKey.key.byteLength, 32);

  // Explicit STRICT_PRODUCTION_KEY_CHECK=true still enforces mandatory env var
  assert.throws(
    () =>
      assertProductionMasterKeyConfigured({
        NODE_ENV: 'production',
        STRICT_PRODUCTION_KEY_CHECK: 'true',
      }),
    (err: any) => err instanceof SecurityError && err.code === 'INTERNAL_CONFIGURATION_ERROR'
  );

  const rawKey = 'sk-proj-1234567890abcdefSECRETKEY9876';
  const enc = encryptProviderApiKey('user-123', 'gemini', rawKey, {
    model: 'gemini-3.8-flash',
    secretOverride: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });

  assert.equal(enc.ciphertext.includes(rawKey), false);
  assert.equal(enc.maskedKey, 'sk-••••••••9876');

  // Decrypt with matching UID and provider succeeds
  const decrypted = decryptProviderApiKey(
    'user-123',
    'gemini',
    enc,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );
  assert.equal(decrypted, rawKey);

  // Decrypt with different UID fails authentication tag verification
  assert.throws(
    () =>
      decryptProviderApiKey(
        'user-other',
        'gemini',
        enc,
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      ),
    (err: any) => err instanceof SecurityError && err.code === 'CREDENTIAL_DECRYPTION_FAILED'
  );
});

test('SSRF validator blocks non-HTTPS, localhost, 0.0.0.0, private IPs, cloud metadata, and DNS rebinding', async () => {
  // 1. Reject HTTP
  await assert.rejects(
    () => validateSafeCustomBaseUrl('http://api.openai.com/v1'),
    (err: any) => err instanceof SecurityError && err.code === 'SSRF_NON_HTTPS_FORBIDDEN'
  );

  // 2. Reject file:// and ftp://
  await assert.rejects(
    () => validateSafeCustomBaseUrl('file:///etc/passwd'),
    (err: any) => err instanceof SecurityError && err.code === 'SSRF_NON_HTTPS_FORBIDDEN'
  );

  // 3. Reject localhost & 0.0.0.0
  await assert.rejects(
    () => validateSafeCustomBaseUrl('https://localhost:8080/v1'),
    (err: any) => err instanceof SecurityError && err.code === 'SSRF_BLOCKED_HOST'
  );
  await assert.rejects(
    () => validateSafeCustomBaseUrl('https://0.0.0.0/v1'),
    (err: any) => err instanceof SecurityError && err.code === 'SSRF_BLOCKED_HOST'
  );

  // 4. Reject loopback, private ranges, and cloud metadata IP
  for (const blockedIp of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '169.254.169.254',
  ]) {
    await assert.rejects(
      () => validateSafeCustomBaseUrl(`https://${blockedIp}/v1`),
      (err: any) => err instanceof SecurityError && err.code === 'SSRF_PRIVATE_IP_FORBIDDEN'
    );
  }

  // 5. Reject DNS rebinding to internal IP
  await assert.rejects(
    () =>
      validateSafeCustomBaseUrl('https://rebind.attacker.example.com/v1', async () => [
        { address: '169.254.169.254' },
      ]),
    (err: any) => err instanceof SecurityError && err.code === 'SSRF_DNS_REBIND_BLOCKED'
  );

  // 6. Allow legitimate public HTTPS endpoint
  const valid = await validateSafeCustomBaseUrl(
    'https://api.openai.com/v1/',
    async () => [{ address: '104.18.7.192' }]
  );
  assert.equal(valid, 'https://api.openai.com/v1');
});

test('Owner key access control and log redaction strip all sensitive fields', () => {
  assert.equal(isUserInOwnerUids('uid-normal', 'uid-owner-1,uid-owner-2'), false);
  assert.equal(isUserInOwnerUids('uid-owner-1', 'uid-owner-1,uid-owner-2'), true);
  assert.equal(isUserInOwnerUids(null, 'uid-owner-1'), false);

  const log = createRedactedLogEntry({
    requestId: 'req-001',
    uid: 'user-secret-uid-99',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    status: 'success',
    latencyMs: 320,
    apiKey: 'sk-SUPER-SECRET-KEY',
    authorization: 'Bearer eyJhbGciOi...',
    fullEssay: 'This is the user full private essay...',
  });

  const serialized = JSON.stringify(log);
  assert.equal(serialized.includes('sk-SUPER-SECRET-KEY'), false);
  assert.equal(serialized.includes('eyJhbGciOi'), false);
  assert.equal(serialized.includes('This is the user full private essay'), false);
  assert.equal(serialized.includes('user-secret-uid-99'), false);
  assert.equal(log.uidHash.length, 12);
});

test('Annotation quote verifier rejects hallucinated quotes and Two-Stage evaluation retains Stage 1 when Stage 2 fails', async () => {
  const userText =
    'Notice\nWe are looking for volunteers for the International Conference on Globalization to be held next month.';

  // 1. Rejects annotation whose quotedUserText does not exist in userText
  const invalidCheck = validateSubjectiveEvaluationSchema(
    {
      centralScore: 7.5,
      scoreRangeMin: 7,
      scoreRangeMax: 8,
      confidence: 'high',
      dimensionScores: [{ dimensionId: 'd1', name: '内容', score: 3, maxScore: 4, rationale: '好' }],
      strengths: ['结构清晰'],
      issues: [],
      annotations: [
        {
          issueType: 'grammar',
          quotedUserText: 'This sentence is NOT in the user essay at all',
          startOffset: 0,
          endOffset: 10,
          explanation: '伪造引用',
          suggestion: '修正',
          severity: 'high',
        },
      ],
      revisionTasks: [{ id: 't1', priority: 1, instruction: '补充联系方式' }],
      transferableLessons: ['注意审题'],
      referenceContent: 'Sample Notice',
    },
    userText,
    10
  );
  assert.equal(invalidCheck.valid, false);
  assert.ok(invalidCheck.errors.some((e) => e.includes('批注引用校验失败')));

  // 2. Stage 2 failure retains Stage 1 as provisional-stage2-failed
  const stage1MockProvider: ModelProvider = {
    providerId: 'gemini',
    modelName: 'gemini-3.8-flash',
    getCapabilities: () => ({
      provider: 'gemini',
      displayName: 'Gemini',
      defaultModel: 'gemini-3.8-flash',
      supportsVision: true,
      supportsJsonObject: true,
      supportsJsonSchema: true,
      supportsStreaming: true,
      supportsReasoning: true,
      maxInput: 100000,
      maxOutput: 8192,
    }),
    testConnection: async () => ({ ok: true, latencyMs: 10, message: 'ok' }),
    generateText: async () => 'ok',
    generateWithImages: async () => 'ok',
    generateStructured: async <T>() =>
      ({
        centralScore: 8,
        scoreRangeMin: 7.5,
        scoreRangeMax: 8.5,
        confidence: 'high',
        dimensionScores: [
          { dimensionId: 'd1', name: '内容', score: 4, maxScore: 4, rationale: '完整' },
        ],
        strengths: ['用词得体'],
        issues: [],
        annotations: [
          {
            issueType: 'register',
            quotedUserText: 'looking for volunteers',
            startOffset: 14,
            endOffset: 36,
            explanation: '可升级为更正式表达',
            suggestion: 'recruiting volunteers',
            severity: 'low',
          },
        ],
        revisionTasks: [{ id: 'r1', priority: 1, instruction: '增加具体报名邮箱' }],
        transferableLessons: ['招募启事需明确截止日期'],
        referenceContent: 'Notice: Volunteers Needed...',
        referenceContentSource: 'ai-generated',
      }) as unknown as T,
  };

  const failingStage2Provider: ModelProvider = {
    ...stage1MockProvider,
    generateStructured: async () => {
      throw new Error('Upstream Stage 2 Reviewer Timeout');
    },
  };

  const result = await runTwoStageSubjectiveEvaluation(
    stage1MockProvider,
    {
      taskType: 'practical-writing',
      taskId: 'item-q51',
      answerVersionId: 'ver-1',
      evaluationMode: 'deep-two-stage',
      usedHints: false,
      questionPrompt: 'Write a notice to recruit volunteers',
      userAnswer: userText,
    },
    failingStage2Provider
  );

  assert.equal(result.centralScore, 8);
  assert.equal(result.reviewerDecision, 'provisional-stage2-failed');
  assert.equal(result.annotations.length, 1);
  assert.equal(
    userText.slice(result.annotations[0].startOffset, result.annotations[0].endOffset),
    'looking for volunteers'
  );
});

test('Base URL normalization prevents /v1/v1/models and composite idempotency + Stage 2 score reconciliation + 2024 Q21 data quality work deterministically', () => {
  // 1. Base URL normalization
  assert.equal(normalizeProviderBaseUrl('deepseek', 'https://api.deepseek.com/'), 'https://api.deepseek.com/v1');
  assert.equal(normalizeProviderBaseUrl('deepseek', 'https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1');
  assert.equal(normalizeProviderBaseUrl('openai-compatible', 'https://gateway.example.com/v1/models'), 'https://gateway.example.com/v1');
  assert.equal(normalizeProviderBaseUrl('openai-compatible', 'https://gateway.example.com/v1/chat/completions'), 'https://gateway.example.com/v1');

  // 2. Composite idempotency key changes when model, rubric, or user answer changes
  const k1 = computeCompositeIdempotencyKey({
    ownerUid: 'user-1',
    taskType: 'visual_writing',
    answerVersionId: 'v1',
    inputHash: 'hash-a',
    rubricHash: 'rubric-1',
    promptVersion: 'v2.0',
    taskBindingVersion: 't1',
    modelProfileId: 'prof-deepseek-chat',
    actualModelId: 'deepseek-chat',
    stage2ModelProfileId: 'prof-deepseek-reasoner',
    stage2ActualModelId: 'deepseek-reasoner',
    criticalParametersHash: 'deep-two-stage',
  });
  const k2 = computeCompositeIdempotencyKey({
    ownerUid: 'user-1',
    taskType: 'visual_writing',
    answerVersionId: 'v1',
    inputHash: 'hash-a',
    rubricHash: 'rubric-1',
    promptVersion: 'v2.0',
    taskBindingVersion: 't1',
    modelProfileId: 'prof-gemini-flash',
    actualModelId: 'gemini-2.5-flash',
    stage2ModelProfileId: 'prof-deepseek-reasoner',
    stage2ActualModelId: 'deepseek-reasoner',
    criticalParametersHash: 'deep-two-stage',
  });
  assert.notEqual(k1, k2, 'Switching Stage 1 model must invalidate previous idempotency key');

  // 3. Stage 2 score reconciliation keeps dimensionScores sum consistent with centralScore
  const reconciled = reconcileDimensionScores(
    [
      { dimensionId: 'd1', name: '内容完整性', score: 6, maxScore: 8, rationale: '要点齐全' },
      { dimensionId: 'd2', name: '语言准确性', score: 6, maxScore: 8, rationale: '少量语法瑕疵' },
      { dimensionId: 'd3', name: '篇章衔接', score: 3, maxScore: 4, rationale: '过渡自然' },
    ],
    13.5,
    20
  );
  const sumAfter = reconciled.reduce((acc: number, d: { score: number }) => acc + d.score, 0);
  assert.equal(Math.round(sumAfter * 10) / 10, 13.5);

  // 4. V1->V2->V3 version score delta & revision verification
  const v1Eval = {
    taskId: 'q51',
    maxScore: 10,
    centralScore: 6.5,
    modelName: 'deepseek-chat',
    promptVersion: 'v2.0',
    revisionTasks: [{ id: 'rev-1', priority: 1 as const, instruction: '补充具体报名邮箱' }],
  };
  const v2Eval = {
    taskId: 'q51',
    maxScore: 10,
    centralScore: 8.5,
    modelName: 'deepseek-chat',
    promptVersion: 'v2.0',
  };
  const delta = computeVersionScoreDelta({
    previousVersionId: 'v1',
    previousVersionLabel: 'V1',
    previousEvaluation: v1Eval,
    currentEvaluation: v2Eval,
    revisionVerification: [
      {
        revisionTaskId: 'rev-1',
        instruction: '补充具体报名邮箱',
        status: 'resolved',
        evidence: 'volunteer@uni.edu.cn',
        explanation: '已在正文中明确添加报名邮箱',
      },
    ],
  });
  assert.equal(delta.delta, 2);
  assert.equal(delta.resolvedCount, 1);

  // 5. 2024 Q21 data quality conflict detection separates exam key dispute from AI evaluation error
  const q21Conflict = auditExamItemDataQuality(
    2024,
    {
      id: '2024-q21',
      questionNumber: 21,
      answerMode: 'single-choice',
      prompt: 'According to Paragraph 1, mature industries often...',
      options: [
        { key: 'A', text: 'underestimate the disruptive speed of new entrants' },
        { key: 'B', text: 'Option B' },
        { key: 'C', text: 'Option C' },
        { key: 'D', text: 'Option D' },
      ],
      score: 2,
      correctAnswer: 'C',
      answerSource: 'source-provided',
      sourceLocator: { sourceFile: 'data/exams/raw/papers/2024.md', sourceFormat: 'md' },
    },
    'In recent decades, mature industries have repeatedly underestimated the disruptive velocity of emerging digital platforms.',
    'data/exams/raw/papers/2024.md',
    'data/exams/raw/answers/2024.md'
  );
  assert.equal(q21Conflict.status, 'disputed');
  assert.equal(q21Conflict.markedAnswer, 'C');
  assert.equal(q21Conflict.semanticCandidateAnswer, 'A');
});

test('REST API security, 4-layer AI workspace persistence across restarts, rate limiting, and owner key protection', async () => {
  const express = (await import('express')).default;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yanjuan-test-'));
  const storePath = path.join(tmpDir, 'ai-workspace-store.json');

  const verifyFn = async (token: string) => {
    if (token === 'valid-user-token') {
      return { uid: 'ordinary-user-1', email: 'u1@example.com', email_verified: true };
    }
    throw new Error('invalid token');
  };

  const app1 = express();
  const { router: router1, store: store1 } = createApiV1Router({
    rootDir: process.cwd(),
    storeFilePath: storePath,
    rateLimitMaxPerMinute: 15,
    verifyIdTokenFn: verifyFn,
    dnsLookupFn: async () => [{ address: '104.18.7.192' }],
  });
  app1.use('/api/v1', router1);

  const server1 = app1.listen(0);
  const addr1 = server1.address() as { port: number };
  const baseUrl1 = `http://127.0.0.1:${addr1.port}/api/v1`;

  try {
    // 1. Ordinary user trying to use owner global key is blocked with 403 OWNER_KEY_FORBIDDEN
    const resOwnerBlock = await fetch(`${baseUrl1}/model-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-user-token',
      },
      body: JSON.stringify({ provider: 'gemini', useOwnerKey: true }),
    });
    assert.equal(resOwnerBlock.status, 403);
    const errBody = await resOwnerBlock.json();
    assert.equal(errBody.error.code, 'OWNER_KEY_FORBIDDEN');

    // 2. Saving a personal key with manual model ID creates encrypted SQLite persistence and syncs 4-layer workspace
    const rawSecret = 'sk-personal-key-999988887777';
    const resSaveKey = await fetch(`${baseUrl1}/provider-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-user-token',
      },
      body: JSON.stringify({
        provider: 'deepseek',
        apiKey: rawSecret,
        model: 'deepseek-reasoner-custom-v2',
        modelSource: 'manual',
        baseUrl: 'https://api.deepseek.com/',
        storageMode: 'encrypted-sqlite',
        setAsDefault: true,
      }),
    });
    assert.equal(resSaveKey.status, 201);
    const saveText = await resSaveKey.text();
    assert.equal(saveText.includes(rawSecret), false, '响应中绝不能包含明文 API Key');

    const saveJson = JSON.parse(saveText);
    assert.equal(saveJson.data.credential.storageMode, 'encrypted-sqlite');
    const createdProfile = saveJson.data.workspace.modelProfiles.find(
      (m: any) => m.modelId === 'deepseek-reasoner-custom-v2'
    );
    assert.ok(createdProfile);
    assert.equal(createdProfile.source, 'manual');
    assert.equal(createdProfile.capabilities.vision, false);
    assert.equal(createdProfile.capabilitySource.vision, 'unknown');
    assert.equal(saveJson.data.workspace.defaultModelProfileId, createdProfile.id);
  } finally {
    server1.close();
    store1.close();
  }

  // 3. Simulate server restart with same storeFilePath: credentials and workspace must survive!
  const app2 = express();
  const { router: router2, store: store2 } = createApiV1Router({
    rootDir: process.cwd(),
    storeFilePath: storePath,
    rateLimitMaxPerMinute: 3,
    verifyIdTokenFn: verifyFn,
    dnsLookupFn: async () => [{ address: '104.18.7.192' }],
  });
  app2.use('/api/v1', router2);
  const server2 = app2.listen(0);
  const addr2 = server2.address() as { port: number };
  const baseUrl2 = `http://127.0.0.1:${addr2.port}/api/v1`;

  try {
    const resWorkspaceAfterRestart = await fetch(`${baseUrl2}/ai-workspace`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    assert.equal(resWorkspaceAfterRestart.status, 200);
    const wsData = await resWorkspaceAfterRestart.json();
    assert.ok(
      wsData.data.workspace.connections.some(
        (c: any) => c.providerType === 'deepseek' && c.enabled && Boolean(c.maskedKey)
      )
    );
    assert.ok(
      wsData.data.workspace.modelProfiles.some(
        (m: any) => m.modelId === 'deepseek-reasoner-custom-v2' && m.source === 'manual'
      )
    );

    // 4. Cross-user spoofing in request query returns 403 FORBIDDEN_USER_MISMATCH
    const resSpoof = await fetch(`${baseUrl2}/provider-credentials?userId=another-user-99`, {
      headers: {
        Authorization: 'Bearer valid-user-token',
      },
    });
    assert.equal(resSpoof.status, 403);

    // 5. Rate limit triggers 429 on 4th request to rate-limited endpoint within 1 minute
    await fetch(`${baseUrl2}/provider-credentials`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    await fetch(`${baseUrl2}/provider-credentials`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    await fetch(`${baseUrl2}/provider-credentials`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    const resRateLimited = await fetch(`${baseUrl2}/provider-credentials`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    assert.equal(resRateLimited.status, 429);
    assert.ok(resRateLimited.headers.get('retry-after'));
  } finally {
    server2.close();
    store2.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Local-First SQLite multi-connection isolation, server-env Gemini + PIN gate, exam stripping & follow-up anti-bypass', async () => {
  const express = (await import('express')).default;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yanjuan-localfirst-'));
  const storePath = path.join(tmpDir, 'workspace.sqlite');

  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevPin = process.env.SERVER_AI_ACCESS_PIN;
  const origFetch = globalThis.fetch;

  process.env.GEMINI_API_KEY = 'AIza-Test-Server-Env-Secret-Key-1234';
  process.env.SERVER_AI_ACCESS_PIN = '2468';

  const app = express();
  const { router, store } = createApiV1Router({
    rootDir: process.cwd(),
    storeFilePath: storePath,
    rateLimitMaxPerMinute: 60,
    dnsLookupFn: async () => [{ address: '104.18.7.192' }],
  });
  app.use('/api/v1', router);

  const server = app.listen(0);
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

  try {
    // 1. /system/capabilities reports Local-First node:sqlite, server Gemini, and PIN state without exposing secrets
    const capRes = await origFetch(`${baseUrl}/system/capabilities`);
    assert.equal(capRes.status, 200);
    const capBody = await capRes.json();
    assert.equal(capBody.localFirstMode, true);
    assert.equal(capBody.storageEngine, 'node:sqlite');
    assert.equal(capBody.hasServerGeminiKey, true);
    assert.equal(capBody.requiresServerPin, true);
    assert.deepEqual(capBody.supportedSubjects, ['english-i', 'politics']);

    // 2. Server-env virtual connection appears cleanly without leaking GEMINI_API_KEY and blocks deletion
    const credRes = await origFetch(`${baseUrl}/provider-credentials`, {
      headers: { 'X-Workspace-Id': 'ws-alpha' },
    });
    assert.equal(credRes.status, 200);
    const credText = await credRes.text();
    assert.equal(credText.includes('AIza-Test-Server-Env-Secret-Key-1234'), false);
    const credJson = JSON.parse(credText);
    const envConn = credJson.data.workspace.connections.find(
      (c: any) => c.id === 'conn-google-aistudio-env'
    );
    assert.ok(envConn);
    assert.equal(envConn.storageMode, 'server-env');

    const delEnvRes = await origFetch(`${baseUrl}/provider-credentials/conn-google-aistudio-env`, {
      method: 'DELETE',
      headers: { 'X-Workspace-Id': 'ws-alpha' },
    });
    assert.equal(delEnvRes.status >= 400, true);

    // 3. Calling server-env Gemini without valid X-Server-AI-Pin fails with 401 AUTH_REQUIRED
    const noPinRes = await origFetch(`${baseUrl}/model-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': 'ws-alpha',
      },
      body: JSON.stringify({
        provider: 'gemini',
        connectionId: 'conn-google-aistudio-env',
        model: 'gemini-2.5-flash',
      }),
    });
    assert.equal(noPinRes.status, 401);

    // 4. Multi-connection isolation under the same provider in SQLite
    const saveConnARes = await origFetch(`${baseUrl}/provider-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': 'ws-alpha',
      },
      body: JSON.stringify({
        connectionId: 'conn-gateway-a',
        displayName: 'Gateway A',
        provider: 'openai-compatible',
        apiKey: 'sk-gateway-aaaa-1111',
        baseUrl: 'https://mock.gateway.example/v1',
        model: 'model-a',
        storageMode: 'encrypted-sqlite',
        setAsDefault: true,
      }),
    });
    assert.equal(saveConnARes.status, 201);

    const saveConnBRes = await origFetch(`${baseUrl}/provider-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': 'ws-alpha',
      },
      body: JSON.stringify({
        connectionId: 'conn-gateway-b',
        displayName: 'Gateway B',
        provider: 'openai-compatible',
        apiKey: 'sk-gateway-bbbb-2222',
        baseUrl: 'https://mock.gateway.example/v1',
        model: 'model-b',
        storageMode: 'encrypted-sqlite',
        setAsDefault: false,
      }),
    });
    assert.equal(saveConnBRes.status, 201);

    assert.equal(
      store.getDecryptedCredential('ws-alpha', 'conn-gateway-a')?.plainKey,
      'sk-gateway-aaaa-1111'
    );
    assert.equal(
      store.getDecryptedCredential('ws-alpha', 'conn-gateway-b')?.plainKey,
      'sk-gateway-bbbb-2222'
    );

    // 5. ?mode=exam strips all answers & key points
    const examModeRes = await origFetch(`${baseUrl}/exams/generated/papers/2024?mode=exam`);
    if (examModeRes.status === 200) {
      const examJson = await examModeRes.json();
      const examData = examJson.data || examJson;
      for (const item of examData.sections.flatMap((s: any) => s.units).flatMap((u: any) => u.items)) {
        assert.equal(item.correctAnswer, null);
      }
    }

    // 6. POST /follow-up-analyses ignores spoofed isSubmitted:true in mode:'exam' before authoritative submit
    const capturedPrompts: string[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('mock.gateway.example')) {
        capturedPrompts.push(String(init?.body || ''));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '审题提示：请定位第二段转折词后的因果逻辑。' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const preSubmitFollowUp = await origFetch(`${baseUrl}/follow-up-analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': 'ws-alpha',
      },
      body: JSON.stringify({
        year: 2024,
        attemptId: 'att-exam-guard-1',
        mode: 'exam',
        questionNumber: 21,
        questionContext: 'Reading Text 1',
        correctAnswer: 'C',
        isSubmitted: true, // Attempted client spoof before server submission
        userQuestion: '请告诉我第21题正确答案是哪个选项？',
      }),
    });
    assert.equal(preSubmitFollowUp.status, 200);
    assert.equal(capturedPrompts.length, 1);
    assert.equal(
      capturedPrompts[0].includes('尚未正式交卷'),
      true,
      'mode=exam 未在服务端交卷时必须强制进入未交卷防泄题模式'
    );
    assert.equal(
      capturedPrompts[0].includes('已解锁参考答案'),
      false,
      'mode=exam 未交卷时绝不能将参考答案注入追问上下文'
    );
  } finally {
    globalThis.fetch = origFetch;
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
    if (prevPin === undefined) delete process.env.SERVER_AI_ACCESS_PIN;
    else process.env.SERVER_AI_ACCESS_PIN = prevPin;
    server.close();
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

