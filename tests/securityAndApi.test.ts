import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSubjectiveEvaluationSchema } from '../src/shared/schemaValidator.ts';
import { runTwoStageSubjectiveEvaluation } from '../src/server/aiEvaluators.ts';
import { createApiV1Router } from '../src/server/apiRouter.ts';
import type { ModelProvider } from '../src/server/modelProviders.ts';
import {
  SecurityError,
  createRedactedLogEntry,
  decryptProviderApiKey,
  encryptProviderApiKey,
  isUserInOwnerUids,
  validateSafeCustomBaseUrl,
} from '../src/server/securityAndCrypto.ts';

test('AES-256-GCM encryption and decryption binds UID and provider as AAD and never leaks plaintext', () => {
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

test('REST API security: rate limiting, credential masking, and blocking ordinary users from owner keys', async () => {
  const express = (await import('express')).default;
  const app = express();
  const { router } = createApiV1Router({
    rateLimitMaxPerMinute: 3,
    verifyIdTokenFn: async (token) => {
      if (token === 'valid-user-token') {
        return { uid: 'ordinary-user-1', email: 'u1@example.com', email_verified: true };
      }
      throw new Error('invalid token');
    },
  });
  app.use('/api/v1', router);

  const server = app.listen(0);
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

  try {
    // 1. Ordinary user trying to use owner global key is blocked with 403 OWNER_KEY_FORBIDDEN
    const resOwnerBlock = await fetch(`${baseUrl}/model-tests`, {
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

    // 2. Saving a personal key returns maskedKey and never returns plaintext key
    const rawSecret = 'sk-personal-key-999988887777';
    const resSaveKey = await fetch(`${baseUrl}/provider-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-user-token',
      },
      body: JSON.stringify({
        provider: 'gemini',
        apiKey: rawSecret,
        model: 'gemini-3.8-flash',
        storageMode: 'encrypted-firestore',
      }),
    });
    assert.equal(resSaveKey.status, 201);
    const saveText = await resSaveKey.text();
    assert.equal(saveText.includes(rawSecret), false, '响应中绝不能包含明文 API Key');

    // 3. Cross-user spoofing in request body returns 403 FORBIDDEN_USER_MISMATCH
    const resSpoof = await fetch(`${baseUrl}/provider-credentials?userId=another-user-99`, {
      headers: {
        Authorization: 'Bearer valid-user-token',
      },
    });
    assert.equal(resSpoof.status, 403);

    // 4. Rate limit triggers 429 on 4th request within 1 minute
    await fetch(`${baseUrl}/provider-credentials`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    const resRateLimited = await fetch(`${baseUrl}/provider-credentials`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    assert.equal(resRateLimited.status, 429);
    assert.ok(resRateLimited.headers.get('retry-after'));
  } finally {
    server.close();
  }
});
