import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildPureMistakeMarkdownExport,
  collectMistakeItemsForScope,
  computeMistakeSummaryCacheKeyAndHash,
  splitMistakeItemsIntoBatches,
} from '../src/domain/mistakeSummary.ts';
import {
  createDefaultLearningDatabase,
  exportLearningDataJson,
  importLearningDataJson,
  migrateDatabasePaperIds,
} from '../src/services/storageAndSync.ts';
import { SqliteBackingStore } from '../src/server/db/sqliteStore.ts';
import { createApiV1Router } from '../src/server/apiRouter.ts';
import { PersistentAIStore } from '../src/server/persistentStore.ts';
import type { Exam, ExamAttempt, ReviewItem, UserAIWorkspaceConfig } from '../src/shared/types.ts';

function buildSampleExam(year: number, isPolitics: boolean): Exam {
  return {
    id: `exam-${year}`,
    year,
    subject: isPolitics ? '考研政治' : '考研英语一',
    subjectId: isPolitics ? 'politics' : 'english-i',
    paperId: isPolitics ? `pol-2027-xiao8-0${year - 2100}` : `en1-${year}`,
    dataVersion: 'v1',
    schemaVersion: '1.0.0',
    durationMinutes: 180,
    totalScore: 100,
    sourceFiles: ['test.md'],
    sourceFormats: ['md'],
    sourceHashes: { 'test.md': '0000' },
    pageCount: 1,
    importStatus: 'ready',
    importRetryCount: 0,
    parserProvider: 'deterministic',
    parserModel: 'rule',
    parserVersion: '1.0.0',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    sections: [
      {
        id: 'sec-1',
        sectionNumber: 'Section I',
        title: isPolitics ? '客观题' : '客观题',
        score: 50,
        suggestedMinutes: 60,
        units: isPolitics
          ? [
              {
                id: `${year}-unit-politics-single`,
                sectionId: 'sec-1',
                unitType: 'politics-single',
                title: '单项选择题',
                instructions: '单选',
                score: 16,
                suggestedMinutes: 20,
                materials: [],
                items: [
                  {
                    id: `${year}-q1`,
                    questionNumber: 1,
                    answerMode: 'single-choice',
                    prompt: '马克思主义物质观认为物质的唯一特性是（ ）。',
                    knowledgeModule: '马原',
                    options: [
                      { key: 'A', text: '运动性' },
                      { key: 'B', text: '客观实在性' },
                      { key: 'C', text: '可知性' },
                      { key: 'D', text: '时空性' },
                    ],
                    score: 1,
                    correctAnswer: 'B',
                    officialExplanation: '物质的唯一特性是客观实在性，根本属性是运动。',
                    answerSource: 'source-provided',
                    sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
                  },
                  {
                    id: `${year}-q2`,
                    questionNumber: 2,
                    answerMode: 'single-choice',
                    prompt: '新民主主义革命的中心问题是（ ）。',
                    knowledgeModule: '史纲',
                    options: [
                      { key: 'A', text: '无产阶级的领导权' },
                      { key: 'B', text: '农民土地问题' },
                    ],
                    score: 1,
                    correctAnswer: 'A',
                    officialExplanation: '无产阶级的领导权是中国革命的中心问题。',
                    answerSource: 'source-provided',
                    sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
                  },
                ],
                analysisProfile: { focusSkills: [], commonTraps: [] },
                reviewStrategy: { defaultIntervalsDays: [1, 3, 7], recommendedAction: '复盘' },
                sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
              },
              {
                id: `${year}-unit-politics-multi`,
                sectionId: 'sec-1',
                unitType: 'politics-multi',
                title: '多项选择题',
                instructions: '多选',
                score: 34,
                suggestedMinutes: 25,
                materials: [],
                items: [
                  {
                    id: `${year}-q17`,
                    questionNumber: 17,
                    answerMode: 'multi-choice',
                    prompt: '矛盾的同一性是指矛盾双方（ ）。',
                    knowledgeModule: '马原',
                    options: [
                      { key: 'A', text: '相互依存' },
                      { key: 'B', text: '相互贯通' },
                      { key: 'C', text: '相互排斥' },
                    ],
                    score: 2,
                    correctAnswer: 'AB',
                    officialExplanation: '矛盾的同一性是指矛盾双方相互依存、相互贯通的性质和趋势。',
                    answerSource: 'source-provided',
                    sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
                  },
                  {
                    id: `${year}-q18`,
                    questionNumber: 18,
                    answerMode: 'multi-choice',
                    prompt: '全面推进依法治国的总目标是（ ）。',
                    knowledgeModule: '毛中特与新思想',
                    options: [
                      { key: 'A', text: '建设中国特色社会主义法治体系' },
                      { key: 'B', text: '建设社会主义法治国家' },
                      { key: 'C', text: '废除所有传统规范' },
                    ],
                    score: 2,
                    correctAnswer: 'AB',
                    officialExplanation: '全面依法治国总目标是建设中国特色社会主义法治体系、建设社会主义法治国家。',
                    answerSource: 'source-provided',
                    sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
                  },
                ],
                analysisProfile: { focusSkills: [], commonTraps: [] },
                reviewStrategy: { defaultIntervalsDays: [1, 3, 7], recommendedAction: '复盘' },
                sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
              },
            ]
          : [
              {
                id: `${year}-unit-reading-1`,
                sectionId: 'sec-1',
                unitType: 'reading',
                title: 'Reading Text 1',
                instructions: 'Read',
                score: 10,
                suggestedMinutes: 18,
                materials: [
                  {
                    id: 'mat-1',
                    materialType: 'passage',
                    text: 'VERY_LONG_ENGLISH_PASSAGE_DO_NOT_SEND_IN_MISTAKE_PAYLOAD_TEXT_MARKER',
                    relatedItemIds: [],
                  },
                ],
                items: [
                  {
                    id: `${year}-q21`,
                    questionNumber: 21,
                    answerMode: 'single-choice',
                    prompt: 'According to Paragraph 1, what happened?',
                    readingMeta: {
                      passageId: 'passage-1',
                      questionCategory: 'detail',
                    },
                    options: [
                      { key: 'A', text: 'Opt A' },
                      { key: 'B', text: 'Opt B' },
                    ],
                    score: 2,
                    correctAnswer: 'B',
                    answerSource: 'source-provided',
                    sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
                  },
                ],
                analysisProfile: { focusSkills: [], commonTraps: [] },
                reviewStrategy: { defaultIntervalsDays: [1, 3, 7], recommendedAction: '复盘' },
                sourceLocator: { sourceFile: 'test.md', sourceFormat: 'md' },
              },
            ],
      },
    ],
    validationReport: {
      examId: `exam-${year}`,
      year,
      dataVersion: 'v1',
      status: 'ready',
      passedAllChecks: true,
      generatedAt: '2026-11-01T00:00:00.000Z',
      checks: [],
      errorCodes: [],
      missingObjectiveQuestions: [],
      conflictingObjectiveQuestions: [],
      sourceDiscrepancies: [],
      consistencyCheckRuns: 1,
      consistencyMatched: true,
    },
  };
}

test('Mistake slicing enforces strict subject isolation, minimal payload, deterministic stats, and unmastered filtering', () => {
  const polExam = buildSampleExam(2101, true);
  const enExam = buildSampleExam(2024, false);

  const attempts: ExamAttempt[] = [
    {
      id: 'att-pol-2101',
      paperId: 'pol-2027-xiao8-01',
      subjectId: 'politics',
      year: 2101,
      dataVersion: 'v1',
      mode: 'free-simulation',
      unitIds: ['2101-unit-politics-single', '2101-unit-politics-multi'],
      status: 'submitted',
      startedAt: '2026-11-10T10:00:00.000Z',
      submittedAt: '2026-11-10T10:20:00.000Z',
      elapsedSeconds: 1200,
      objectiveResponses: {
        1: {
          questionNumber: 1,
          itemId: '2101-q1',
          unitId: '2101-unit-politics-single',
          unitType: 'politics-single',
          selectedAnswer: 'A',
          confidence: 'certain',
          flaggedForReview: false,
          timeSpentSeconds: 20,
          isCorrect: false,
          correctAnswer: 'B',
          scoreEarned: 0,
          maxScore: 1,
          knownErrorCauses: ['概念混淆'],
          possibleErrorCauses: [],
          userNotes: '运动是根本属性，客观实在性才是唯一特性',
          highlights: [],
        },
        2: {
          questionNumber: 2,
          itemId: '2101-q2',
          unitId: '2101-unit-politics-single',
          unitType: 'politics-single',
          selectedAnswer: 'A',
          confidence: 'certain',
          flaggedForReview: false,
          timeSpentSeconds: 15,
          isCorrect: true,
          correctAnswer: 'A',
          scoreEarned: 1,
          maxScore: 1,
          knownErrorCauses: [],
          possibleErrorCauses: [],
          userNotes: '',
          highlights: [],
        },
        17: {
          questionNumber: 17,
          itemId: '2101-q17',
          unitId: '2101-unit-politics-multi',
          unitType: 'politics-multi',
          selectedAnswer: 'A', // partial-miss only (missing B)
          confidence: 'hesitant',
          flaggedForReview: false,
          timeSpentSeconds: 30,
          isCorrect: false,
          correctAnswer: 'AB',
          scoreEarned: 0,
          maxScore: 2,
          knownErrorCauses: [],
          possibleErrorCauses: [],
          userNotes: '漏选B',
          highlights: [],
        },
        18: {
          questionNumber: 18,
          itemId: '2101-q18',
          unitId: '2101-unit-politics-multi',
          unitType: 'politics-multi',
          selectedAnswer: 'AC', // wrong-option C selected
          confidence: 'certain',
          flaggedForReview: false,
          timeSpentSeconds: 25,
          isCorrect: false,
          correctAnswer: 'AB',
          scoreEarned: 0,
          maxScore: 2,
          knownErrorCauses: [],
          possibleErrorCauses: [],
          userNotes: '',
          highlights: [],
        },
      },
      subjectiveVersionIds: [],
      updatedAt: '2026-11-10T10:20:00.000Z',
      clientRevision: 2,
      deviceId: 'dev-1',
    },
    {
      id: 'att-en-2024',
      paperId: 'en1-2024',
      subjectId: 'english-i',
      year: 2024,
      dataVersion: 'v1',
      mode: 'free-simulation',
      unitIds: ['2024-unit-reading-1'],
      status: 'submitted',
      startedAt: '2026-11-11T10:00:00.000Z',
      submittedAt: '2026-11-11T10:20:00.000Z',
      elapsedSeconds: 1200,
      objectiveResponses: {
        21: {
          questionNumber: 21,
          itemId: '2024-q21',
          unitId: '2024-unit-reading-1',
          unitType: 'reading',
          selectedAnswer: 'A',
          confidence: 'certain',
          flaggedForReview: false,
          timeSpentSeconds: 60,
          isCorrect: false,
          correctAnswer: 'B',
          scoreEarned: 0,
          maxScore: 2,
          knownErrorCauses: [],
          possibleErrorCauses: [],
          userNotes: '定位偏了',
          highlights: [],
        },
      },
      subjectiveVersionIds: [],
      updatedAt: '2026-11-11T10:20:00.000Z',
      clientRevision: 2,
      deviceId: 'dev-1',
    },
  ];

  // Mark Q18 as mastered in reviewItems
  const reviewItems: ReviewItem[] = [
    {
      id: 'rev-q18',
      paperId: 'pol-2027-xiao8-01',
      subjectId: 'politics',
      year: 2101,
      dataVersion: 'v1',
      unitId: '2101-unit-politics-multi',
      unitType: 'politics-multi',
      questionNumber: 18,
      reviewType: 'objective-confident-error',
      title: 'Q18',
      promptSnapshot: '...',
      previousUserAnswer: 'AC',
      previousFeedbackSummary: '...',
      knownErrorCauses: [],
      intervalDays: 7,
      repetitionCount: 2,
      mastered: true,
      nextDueAt: '2026-11-20T00:00:00.000Z',
      lastReviewedAt: '2026-11-12T00:00:00.000Z',
      createdAt: '2026-11-10T10:20:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
      clientRevision: 2,
      deviceId: 'dev-1',
    },
  ];

  const examsByYear = { 2101: polExam, 2024: enExam };

  // 1. Politics By-Subject (unmastered only -> Q1 & Q17, excludes Q18 mastered & excludes English Q21!)
  const polUnmastered = collectMistakeItemsForScope({
    attempts,
    reviewItems,
    examsByYear,
    scope: 'by-subject',
    subjectId: 'politics',
    filterMode: 'unmastered',
    moduleKey: 'all',
  });
  assert.equal(polUnmastered.items.length, 2);
  assert.ok(polUnmastered.items.every((i) => i.subjectId === 'politics'));
  assert.equal(polUnmastered.stats.totalWrong, 2);
  assert.equal(polUnmastered.stats.multiPartialMissOnly, 1);
  assert.equal(polUnmastered.stats.multiWrongOptionSelected, 0);
  assert.ok(polUnmastered.items.every((i) => Boolean(i.officialExplanation)));

  // 2. Politics By-Subject (all mistakes -> includes Q18 wrong-option)
  const polAll = collectMistakeItemsForScope({
    attempts,
    reviewItems,
    examsByYear,
    scope: 'by-subject',
    subjectId: 'politics',
    filterMode: 'all',
    moduleKey: 'all',
  });
  assert.equal(polAll.items.length, 3);
  assert.equal(polAll.stats.multiTotalWrong, 2);
  assert.equal(polAll.stats.multiPartialMissOnly, 1);
  assert.equal(polAll.stats.multiWrongOptionSelected, 1);

  // 3. Single module selection ('马原')
  const maYuanOnly = collectMistakeItemsForScope({
    attempts,
    reviewItems,
    examsByYear,
    scope: 'by-subject',
    subjectId: 'politics',
    filterMode: 'all',
    moduleKey: '马原',
  });
  assert.equal(maYuanOnly.items.length, 2);
  assert.ok(maYuanOnly.items.every((i) => i.moduleKey === '马原'));

  // 4. English I isolation & NO full reading passage in minimal payload
  const enResult = collectMistakeItemsForScope({
    attempts,
    reviewItems,
    examsByYear,
    scope: 'by-subject',
    subjectId: 'english-i',
    filterMode: 'all',
    moduleKey: 'all',
  });
  assert.equal(enResult.items.length, 1);
  assert.equal(enResult.items[0].questionNumber, 21);
  assert.equal(enResult.items[0].questionCategory, 'detail');
  assert.equal(
    JSON.stringify(enResult.items).includes('VERY_LONG_ENGLISH_PASSAGE_DO_NOT_SEND'),
    false,
    'Minimal payload must NEVER include full English reading passage text'
  );

  // 5. Pure Markdown export works without AI
  const pureMd = buildPureMistakeMarkdownExport({
    title: '政治测试导出',
    subjectId: 'politics',
    stats: polAll.stats,
    items: polAll.items,
  });
  assert.ok(pureMd.includes('马原'));
  assert.ok(pureMd.includes('官方解析'));
});

test('Cache key/hash invalidation and 25-item batch splitting by secondary module', () => {
  const polExam = buildSampleExam(2101, true);
  // Synthesize 35 items across two modules (28 in 马原, 7 in 史纲)
  const items = Array.from({ length: 35 }, (_, idx) => {
    const isMaYuan = idx < 28;
    return {
      paperId: 'pol-2027-xiao8-01',
      paperYear: 2101,
      paperTitle: '2027 肖八第 1 套',
      subjectId: 'politics' as const,
      questionNumber: idx + 1,
      unitType: 'politics-single' as const,
      moduleKey: isMaYuan ? '马原' : '史纲',
      moduleLabel: isMaYuan ? '马原' : '史纲',
      knowledgeModule: isMaYuan ? '马原' : '史纲',
      prompt: `Q${idx + 1}: ${polExam.sections[0].units[0].items[0].prompt}`,
      options: [{ key: 'A' as const, text: 'Opt A' }],
      userSelectedAnswer: 'A',
      correctAnswer: 'B',
      officialExplanation: '官方解析文本',
      userNotes: '',
      knownErrorCauses: [],
      confidence: 'certain' as const,
      mastered: false,
    };
  });

  const batches = splitMistakeItemsIntoBatches(items, 25);
  assert.equal(batches.length, 3); // 25 (马原 1/2), 3 (马原 2/2), 7 (史纲)
  assert.ok(batches.every((b) => b.items.length <= 25));
  assert.equal(batches[0].items.length, 25);
  assert.equal(batches[1].items.length, 3);
  assert.equal(batches[2].items.length, 7);

  // Cache hash stays deterministic for identical items and changes when notes/answer change
  const h1 = computeMistakeSummaryCacheKeyAndHash({
    scope: 'by-subject',
    subjectId: 'politics',
    filterMode: 'unmastered',
    moduleKey: 'all',
    items: items.slice(0, 5),
  });
  const h2 = computeMistakeSummaryCacheKeyAndHash({
    scope: 'by-subject',
    subjectId: 'politics',
    filterMode: 'unmastered',
    moduleKey: 'all',
    items: items.slice(0, 5),
  });
  assert.equal(h1.cacheKey, h2.cacheKey);
  assert.equal(h1.inputHash, h2.inputHash);

  const modified = [...items.slice(0, 5)];
  modified[0] = { ...modified[0], userNotes: '新增个人反思笔记' };
  const h3 = computeMistakeSummaryCacheKeyAndHash({
    scope: 'by-subject',
    subjectId: 'politics',
    filterMode: 'unmastered',
    moduleKey: 'all',
    items: modified,
  });
  assert.notEqual(h1.inputHash, h3.inputHash);
});

test('Zero data loss migration: legacy LocalLearningDatabase & legacy SQLite taskBindings backfill safely', () => {
  // 1. Legacy v2.0.0 LocalLearningDatabase missing `mistakeSummaries`
  const legacyDb = createDefaultLearningDatabase('dev-legacy');
  delete (legacyDb as any).mistakeSummaries;
  legacyDb.attempts['att-keep'] = {
    id: 'att-keep',
    paperId: 'en1-2024',
    subjectId: 'english-i',
    year: 2024,
    dataVersion: 'v1',
    mode: 'free-simulation',
    unitIds: ['2024-unit-reading-1'],
    status: 'submitted',
    startedAt: '2026-10-01T00:00:00.000Z',
    submittedAt: '2026-10-01T01:00:00.000Z',
    elapsedSeconds: 3600,
    objectiveResponses: {
      21: {
        questionNumber: 21,
        itemId: '2024-q21',
        unitId: '2024-unit-reading-1',
        unitType: 'reading',
        selectedAnswer: 'A',
        confidence: 'certain',
        flaggedForReview: false,
        timeSpentSeconds: 90,
        isCorrect: false,
        correctAnswer: 'B',
        maxScore: 2,
        knownErrorCauses: ['偷换概念'],
        possibleErrorCauses: [],
        userNotes: '保留用户的珍贵笔记！',
        highlights: [{ text: 'key sentence' }],
      },
    },
    subjectiveVersionIds: ['ver-keep-1'],
    updatedAt: '2026-10-01T01:00:00.000Z',
    clientRevision: 3,
    deviceId: 'dev-legacy',
  };
  legacyDb.subjectiveVersions['ver-keep-1'] = {
    id: 'ver-keep-1',
    attemptId: 'att-keep',
    paperId: 'en1-2024',
    subjectId: 'english-i',
    year: 2024,
    dataVersion: 'v1',
    unitId: '2024-unit-translation',
    unitType: 'translation',
    questionNumber: 46,
    versionNumber: 1,
    versionLabel: 'V1 原稿',
    practiceMode: 'independent',
    content: 'Keep my translation intact.',
    wordCount: 4,
    durationSeconds: 180,
    usedHints: [],
    parentVersionId: null,
    evaluationId: null,
    createdAt: '2026-10-01T00:30:00.000Z',
    deviceId: 'dev-legacy',
    clientRevision: 1,
  };

  const migrated = migrateDatabasePaperIds(legacyDb);
  assert.deepEqual(migrated.mistakeSummaries, {});
  assert.equal(
    migrated.attempts['att-keep'].objectiveResponses[21].userNotes,
    '保留用户的珍贵笔记！'
  );
  assert.deepEqual(
    migrated.attempts['att-keep'].objectiveResponses[21].knownErrorCauses,
    ['偷换概念']
  );
  assert.equal(
    migrated.subjectiveVersions['ver-keep-1'].content,
    'Keep my translation intact.'
  );

  // Import old export JSON without mistakeSummaries
  const oldExportRaw = exportLearningDataJson(legacyDb);
  const imported = importLearningDataJson(
    createDefaultLearningDatabase('dev-new'),
    oldExportRaw
  );
  assert.deepEqual(imported.mistakeSummaries, {});
  assert.equal(
    imported.attempts['att-keep'].objectiveResponses[21].userNotes,
    '保留用户的珍贵笔记！'
  );
  assert.equal(imported.subjectiveVersions['ver-keep-1'].content, 'Keep my translation intact.');

  // 2. Legacy SQLite workspace missing `mistake_summary` in taskBindings
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yanjuan-ms-mig-'));
  const dbPath = path.join(tmpDir, 'ws.sqlite');
  try {
    const rawSqlite = new SqliteBackingStore(dbPath);
    const oldWs: any = {
      ownerUid: 'legacy-user',
      defaultModelProfileId: 'prof-custom-ds',
      connections: [
        {
          id: 'conn-custom-ds',
          ownerUid: 'legacy-user',
          providerType: 'deepseek',
          displayName: '我的旧DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          protocolMode: 'chat-completions',
          authenticationType: 'bearer',
          credentialReference: 'legacy-user:conn-custom-ds',
          maskedKey: 'sk-••••1234',
          storageMode: 'persistent-encrypted',
          enabled: true,
          configurationHash: 'abc',
          lastTestStatus: 'success',
          lastTestedAt: '2026-10-01T00:00:00.000Z',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      modelProfiles: [
        {
          id: 'prof-custom-ds',
          connectionId: 'conn-custom-ds',
          ownerUid: 'legacy-user',
          providerType: 'deepseek',
          modelId: 'deepseek-chat',
          displayName: 'deepseek-chat',
          source: 'manual',
          capabilities: {
            text: true,
            structuredOutput: true,
            jsonSchema: false,
            jsonObject: true,
            vision: false,
            streaming: true,
            reasoning: false,
          },
          capabilitySource: {
            text: 'manual',
            structuredOutput: 'verified',
            vision: 'unknown',
            streaming: 'unknown',
            reasoning: 'unknown',
          },
          contextWindow: 65536,
          outputLimit: 8192,
          structuredOutputStrategy: 'json_object',
          defaultParameters: { temperature: 0.2, maxOutputTokens: 4096, timeoutMs: 30000 },
          configurationHash: 'abc',
          lastVerifiedAt: null,
          enabled: true,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      taskBindings: {
        objective_explanation: {
          taskType: 'objective_explanation',
          primaryModelProfileId: 'prof-custom-ds',
          fallbackModelProfileId: null,
          timeoutMs: 25000,
          retryBudget: 1,
          temperature: 0.2,
          maxOutputTokens: 2048,
          structuredOutputStrategy: 'json_object',
          promptVersion: 'yanjuan-obj-v2.0',
          enabled: true,
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      },
      dailyBudgetUsd: 5,
      dailySpentUsd: 0,
      maxConcurrentJobs: 3,
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    rawSqlite.saveWorkspace('legacy-user', oldWs as UserAIWorkspaceConfig);
    rawSqlite.close();

    const store = new PersistentAIStore(dbPath);
    const loadedWs = store.getWorkspace('legacy-user');
    assert.equal(loadedWs.connections.some((c) => c.id === 'conn-custom-ds'), true);
    assert.equal(loadedWs.defaultModelProfileId, 'prof-custom-ds');
    assert.equal(
      loadedWs.taskBindings.objective_explanation.primaryModelProfileId,
      'prof-custom-ds'
    );
    assert.equal(
      loadedWs.taskBindings.mistake_summary?.primaryModelProfileId,
      'prof-custom-ds',
      'Missing mistake_summary binding must seamlessly fallback to existing defaultModelProfileId'
    );
    store.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('POST /api/v1/mistake-summaries enforces batch cap <= 30, keeps politics officialExplanation, and persists EvaluationRun', async () => {
  const express = (await import('express')).default;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yanjuan-ms-api-'));
  const storePath = path.join(tmpDir, 'api.sqlite');
  const origFetch = globalThis.fetch;

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
    // Save provider credential first
    const credRes = await origFetch(`${baseUrl}/provider-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'ws-ms' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        apiKey: 'sk-secret-ms-9999',
        baseUrl: 'https://mock.ms.example/v1',
        model: 'mock-summary-model',
        storageMode: 'encrypted-sqlite',
        setAsDefault: true,
      }),
    });
    assert.equal(credRes.status, 201);

    // Reject > 30 items
    const over30 = Array.from({ length: 31 }, (_, i) => ({
      paperId: 'pol-2027-xiao8-01',
      paperYear: 2101,
      paperTitle: '2027 肖八第 1 套',
      subjectId: 'politics',
      questionNumber: i + 1,
      unitType: 'politics-single',
      moduleKey: '马原',
      moduleLabel: '马原',
      prompt: 'test',
      options: [],
      userSelectedAnswer: 'A',
      correctAnswer: 'B',
      officialExplanation: '官方解析',
      userNotes: '',
      knownErrorCauses: [],
      confidence: 'certain',
      mastered: false,
    }));
    const overRes = await origFetch(`${baseUrl}/mistake-summaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'ws-ms' },
      body: JSON.stringify({
        subjectId: 'politics',
        scope: 'by-subject',
        items: over30,
      }),
    });
    assert.equal(overRes.status, 400);

    let capturedBody = '';
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('mock.ms.example')) {
        capturedBody = String(init?.body || '');
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '## 一、高频失分知识点聚类\n- 马原物质观 (Q1)\n\n## 二、错误模式与干扰项陷阱诊断\n- 混淆根本属性与唯一特性\n\n## 三、考前速记纠偏对照表\n| 考点 / 题号 | 常见误区 / 错选直觉 | 官方准确结论 |\n| --- | --- | --- |\n| 物质特性 Q1 | 误选运动性 | 唯一特性是客观实在性 |',
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const okRes = await origFetch(`${baseUrl}/mistake-summaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'ws-ms' },
      body: JSON.stringify({
        subjectId: 'politics',
        scope: 'by-subject',
        scopeTitle: '考研政治马原错题总结',
        items: over30.slice(0, 2),
      }),
    });
    assert.equal(okRes.status, 200);
    const okText = await okRes.text();
    assert.equal(okText.includes('sk-secret-ms-9999'), false);
    const okJson = JSON.parse(okText);
    assert.ok(okJson.data.markdown.includes('## 三、考前速记纠偏对照表'));
    assert.ok(capturedBody.includes('官方解析'), 'Politics prompt must include officialExplanation');
    assert.ok(capturedBody.includes('严禁推翻或质疑官方'));

    const runs = store.listEvaluationRuns('ws-ms', 10);
    assert.ok(runs.some((r) => r.taskType === 'mistake_summary' && r.status === 'completed'));
  } finally {
    globalThis.fetch = origFetch;
    server.close();
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
