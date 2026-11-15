import assert from 'node:assert/strict';
import test from 'node:test';
import type { Exam, SubjectiveEvaluationResult } from '../src/shared/types.ts';
import {
  appendSubjectiveAnswerVersion,
  createDefaultLearningDatabase,
  exportLearningDataJson,
  importLearningDataJson,
  mergeLearningDatabasesWithConflictDetection,
  migrateDatabasePaperIds,
} from '../src/services/storageAndSync.ts';
import { computeVersionDiff } from '../src/shared/schemaValidator.ts';
import {
  buildObjectiveReviewItems,
  buildSubjectiveReviewItems,
  calculateNextReviewSchedule,
  gradeObjectiveResponses,
} from '../src/shared/scoringAndReview.ts';

test('Deterministic objective scoring, confidence distribution, and spaced repetition review scheduling', () => {
  // Construct a synthetic unit-test mock exam (never attaching guessed answers to 2010!)
  const syntheticExam: Exam = {
    id: 'exam-mock-unit-test',
    year: 2099,
    subject: '考研英语一',
    dataVersion: 'v1',
    schemaVersion: '1.0.0',
    durationMinutes: 180,
    totalScore: 100,
    sourceFiles: ['mock.md'],
    sourceFormats: ['md'],
    sourceHashes: { 'mock.md': '0000' },
    pageCount: 1,
    importStatus: 'ready',
    importRetryCount: 0,
    parserProvider: 'deterministic',
    parserModel: 'rule-engine',
    parserVersion: '1.0.0',
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    sections: [
      {
        id: 'sec-1',
        sectionNumber: 'Section I',
        title: 'Use of English',
        score: 10,
        suggestedMinutes: 18,
        units: [
          {
            id: 'unit-cloze',
            sectionId: 'sec-1',
            unitType: 'cloze',
            title: 'Cloze Test',
            instructions: 'Choose A, B, C or D.',
            score: 0.5,
            suggestedMinutes: 18,
            materials: [],
            items: [
              {
                id: 'item-q1',
                questionNumber: 1,
                answerMode: 'single-choice',
                prompt: 'Mock Q1',
                options: [
                  { key: 'A', text: 'Opt A' },
                  { key: 'B', text: 'Opt B' },
                  { key: 'C', text: 'Opt C' },
                  { key: 'D', text: 'Opt D' },
                ],
                score: 0.5,
                correctAnswer: 'B',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
            ],
            analysisProfile: { focusSkills: ['逻辑衔接'], commonTraps: ['近义干扰'] },
            reviewStrategy: { defaultIntervalsDays: [1, 3, 7, 14, 30], recommendedAction: '复盘' },
            sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
          },
          {
            id: 'unit-reading-text-1',
            sectionId: 'sec-2',
            unitType: 'reading',
            title: 'Reading Text 1',
            instructions: 'Read and answer.',
            score: 4,
            suggestedMinutes: 18,
            materials: [],
            items: [
              {
                id: 'item-q21',
                questionNumber: 21,
                answerMode: 'single-choice',
                prompt: 'Mock Q21',
                options: [
                  { key: 'A', text: 'Opt A' },
                  { key: 'B', text: 'Opt B' },
                  { key: 'C', text: 'Opt C' },
                  { key: 'D', text: 'Opt D' },
                ],
                score: 2,
                correctAnswer: 'B',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'item-q22',
                questionNumber: 22,
                answerMode: 'single-choice',
                prompt: 'Mock Q22',
                options: [
                  { key: 'A', text: 'Opt A' },
                  { key: 'B', text: 'Opt B' },
                  { key: 'C', text: 'Opt C' },
                  { key: 'D', text: 'Opt D' },
                ],
                score: 2,
                correctAnswer: 'D',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
            ],
            analysisProfile: { focusSkills: ['细节定位'], commonTraps: ['偷换概念'] },
            reviewStrategy: { defaultIntervalsDays: [1, 3, 7, 14, 30], recommendedAction: '复盘' },
            sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
          },
        ],
      },
    ],
    validationReport: {
      examId: 'exam-mock-unit-test',
      year: 2099,
      dataVersion: 'v1',
      status: 'ready',
      passedAllChecks: true,
      generatedAt: '2026-10-19T00:00:00.000Z',
      checks: [],
      errorCodes: [],
      missingObjectiveQuestions: [],
      conflictingObjectiveQuestions: [],
      sourceDiscrepancies: [],
      consistencyCheckRuns: 2,
      consistencyMatched: true,
    },
  };

  // Q1 correct is B (0.5pt), Q21 correct is B (2pt), Q22 correct is D (2pt)
  const summary = gradeObjectiveResponses(syntheticExam, {
    1: {
      questionNumber: 1,
      itemId: 'item-q1',
      unitId: 'unit-cloze',
      unitType: 'cloze',
      selectedAnswer: 'B',
      confidence: 'guessed', // Guessed right!
      flaggedForReview: false,
      timeSpentSeconds: 30,
      maxScore: 0.5,
      knownErrorCauses: [],
      possibleErrorCauses: [],
      userNotes: '',
      highlights: [],
    },
    21: {
      questionNumber: 21,
      itemId: 'item-q21',
      unitId: 'unit-reading-text-1',
      unitType: 'reading',
      selectedAnswer: 'A', // Wrong while certain!
      confidence: 'certain',
      flaggedForReview: false,
      timeSpentSeconds: 95,
      maxScore: 2,
      knownErrorCauses: ['定位句长难句主干拆错'],
      possibleErrorCauses: [],
      userNotes: '',
      highlights: [],
    },
    22: {
      questionNumber: 22,
      itemId: 'item-q22',
      unitId: 'unit-reading-text-1',
      unitType: 'reading',
      selectedAnswer: 'D',
      confidence: 'certain',
      flaggedForReview: false,
      timeSpentSeconds: 60,
      maxScore: 2,
      knownErrorCauses: [],
      possibleErrorCauses: [],
      userNotes: '',
      highlights: [],
    },
  });

  assert.equal(summary.totalScoreEarned, 2.5);
  assert.equal(summary.maxObjectiveScore, 4.5);
  assert.deepEqual(summary.guessedRightQuestions, [1]);
  assert.deepEqual(summary.confidentButWrongQuestions, [21]);
  assert.deepEqual(summary.itemResults[21].knownErrorCauses, ['定位句长难句主干拆错']);
  assert.ok(summary.itemResults[21].possibleErrorCauses.length > 0);

  // Auto-generated review items include Q1 (guessed right) and Q21 (confident error), not Q22
  const reviewItems = buildObjectiveReviewItems(syntheticExam, summary.itemResults);
  assert.equal(reviewItems.length, 2);
  assert.ok(reviewItems.some((r) => r.questionNumber === 1 && r.reviewType === 'objective-guessed-right'));
  assert.ok(reviewItems.some((r) => r.questionNumber === 21 && r.reviewType === 'objective-confident-error'));

  // Regression guard: passing non-ISO attemptId as 3rd string or options object never throws RangeError: Invalid time value
  const legacyStringArgItems = buildObjectiveReviewItems(
    syntheticExam,
    summary.itemResults,
    'attempt-2099-v1-paper-check-1700000000'
  );
  assert.equal(legacyStringArgItems.length, 2);
  assert.ok(!Number.isNaN(new Date(legacyStringArgItems[0].nextDueAt).getTime()));

  const optionsArgItems = buildObjectiveReviewItems(
    syntheticExam,
    summary.itemResults,
    { attemptId: 'att-quick-check-1', nowIso: '2026-11-14T10:00:00.000Z' }
  );
  assert.equal(optionsArgItems.length, 2);
  assert.equal(optionsArgItems[0].paperId, 'en1-2099');
  assert.ok(optionsArgItems[0].id.includes('att-quick-check-1'));

  // Spaced repetition schedule progression: 1d -> 3d -> 7d -> reset on failure
  let rev = reviewItems[0];
  assert.equal(rev.intervalDays, 1);
  rev = calculateNextReviewSchedule(rev, true, true);
  assert.equal(rev.intervalDays, 3);
  rev = calculateNextReviewSchedule(rev, true, true);
  assert.equal(rev.intervalDays, 7);
  rev = calculateNextReviewSchedule(rev, false, false);
  assert.equal(rev.intervalDays, 3);
});

test('Immutable subjective answer versions (V1, V2, V3), version diff, multi-device conflict detection, and export/import', () => {
  let db = createDefaultLearningDatabase('device-A');

  const v1Res = appendSubjectiveAnswerVersion(db, {
    id: 'ver-fixed-1',
    attemptId: 'att-1',
    year: 2010,
    dataVersion: 'v2',
    unitId: 'unit-writing-part-a',
    unitType: 'practical-writing',
    questionNumber: 51,
    practiceMode: 'independent',
    content: 'Notice: We need volunteers for the conference.',
    durationSeconds: 600,
    usedHints: [],
  });
  db = v1Res.updatedDb;
  assert.equal(v1Res.createdVersion.versionNumber, 1);
  assert.equal(v1Res.createdVersion.versionLabel, 'V1 原稿');

  // Attempting to overwrite ver-fixed-1 throws IMMUTABLE_VERSION_OVERWRITE_FORBIDDEN
  assert.throws(
    () =>
      appendSubjectiveAnswerVersion(db, {
        id: 'ver-fixed-1',
        attemptId: 'att-1',
        year: 2010,
        dataVersion: 'v2',
        unitId: 'unit-writing-part-a',
        unitType: 'practical-writing',
        questionNumber: 51,
        practiceMode: 'rewrite',
        content: 'Overwritten content',
        durationSeconds: 300,
        usedHints: [],
      }),
    /IMMUTABLE_VERSION_OVERWRITE_FORBIDDEN/
  );

  // Submitting revision creates V2 and links parentVersionId to V1
  const v2Res = appendSubjectiveAnswerVersion(db, {
    attemptId: 'att-1',
    year: 2010,
    dataVersion: 'v2',
    unitId: 'unit-writing-part-a',
    unitType: 'practical-writing',
    questionNumber: 51,
    practiceMode: 'rewrite',
    content: 'Notice: We are recruiting fluent English volunteers for the International Conference.',
    durationSeconds: 450,
    usedHints: [],
  });
  db = v2Res.updatedDb;
  assert.equal(v2Res.createdVersion.versionNumber, 2);
  assert.equal(v2Res.createdVersion.versionLabel, 'V2 修改稿');
  assert.equal(v2Res.createdVersion.parentVersionId, 'ver-fixed-1');
  assert.equal(db.subjectiveVersions['ver-fixed-1'].content, 'Notice: We need volunteers for the conference.');

  // Diff between V1 and V2
  const diff = computeVersionDiff(
    v1Res.createdVersion.content,
    v2Res.createdVersion.content
  );
  assert.ok(diff.addedCount > 0 || diff.modifiedCount > 0);

  // Multi-device conflict detection on attempts
  db.attempts['att-shared'] = {
    id: 'att-shared',
    year: 2010,
    dataVersion: 'v2',
    mode: 'free-simulation',
    unitIds: ['unit-cloze'],
    status: 'in-progress',
    startedAt: '2026-10-19T01:00:00.000Z',
    submittedAt: null,
    elapsedSeconds: 120,
    objectiveResponses: {
      1: {
        questionNumber: 1,
        itemId: 'item-q1',
        unitId: 'unit-cloze',
        unitType: 'cloze',
        selectedAnswer: 'A',
        confidence: 'certain',
        flaggedForReview: false,
        timeSpentSeconds: 20,
        maxScore: 0.5,
        knownErrorCauses: [],
        possibleErrorCauses: [],
        userNotes: '',
        highlights: [],
      },
    },
    subjectiveVersionIds: [],
    updatedAt: '2026-10-19T01:02:00.000Z',
    clientRevision: 1,
    deviceId: 'device-A',
  };

  const remoteDb = createDefaultLearningDatabase('device-B');
  remoteDb.attempts['att-shared'] = {
    ...db.attempts['att-shared'],
    objectiveResponses: {
      1: {
        ...db.attempts['att-shared'].objectiveResponses[1],
        selectedAnswer: 'B',
      },
    },
    updatedAt: '2026-10-19T01:05:00.000Z',
    clientRevision: 2,
    deviceId: 'device-B',
  };

  const merged = mergeLearningDatabasesWithConflictDetection(db, remoteDb);
  assert.equal(merged.hasConflict, true);
  assert.equal(merged.syncStatus, 'conflict');
  assert.equal(merged.mergedDb.conflictRecords.length, 1);

  // Export and import round-trip
  const exportedJson = exportLearningDataJson(merged.mergedDb);
  const restoredDb = importLearningDataJson(createDefaultLearningDatabase('device-C'), exportedJson);
  assert.equal(Object.keys(restoredDb.subjectiveVersions).length, 2);
});

test('Politics analysis immutable versions, review items, and legacy paperId database migration', () => {
  let db = createDefaultLearningDatabase('device-pol');

  // Legacy record lacking paperId / subjectId
  db.attempts['att-legacy-2018'] = {
    id: 'att-legacy-2018',
    year: 2018,
    dataVersion: 'v1',
    mode: 'free-simulation',
    unitIds: ['unit-cloze'],
    status: 'in-progress',
    startedAt: '2026-11-01T00:00:00.000Z',
    submittedAt: null,
    elapsedSeconds: 45,
    objectiveResponses: {},
    subjectiveVersionIds: [],
    updatedAt: '2026-11-01T00:00:45.000Z',
    clientRevision: 1,
    deviceId: 'device-pol',
  };

  const migrated = migrateDatabasePaperIds(db);
  assert.equal(migrated.schemaVersion, '2.0.0');
  assert.equal(migrated.attempts['att-legacy-2018'].paperId, 'en1-2018');
  assert.equal(migrated.attempts['att-legacy-2018'].subjectId, 'english-i');

  const polV1 = appendSubjectiveAnswerVersion(migrated, {
    attemptId: 'att-pol-1',
    year: 2101,
    dataVersion: 'v1',
    unitId: 'unit-politics-analysis',
    unitType: 'politics-analysis',
    questionNumber: 34,
    practiceMode: 'independent',
    content: '矛盾的普遍性与特殊性辩证关系原理表明，共性寓于个性之中，应坚持具体问题具体分析。',
    durationSeconds: 320,
    usedHints: [],
  });

  assert.equal(polV1.createdVersion.paperId, 'pol-2027-xiao8-01');
  assert.equal(polV1.createdVersion.subjectId, 'politics');
  assert.equal(polV1.createdVersion.unitType, 'politics-analysis');
  assert.ok(polV1.createdVersion.wordCount >= 30);

  const mockEval: SubjectiveEvaluationResult = {
    id: 'eval-pol-34',
    answerVersionId: polV1.createdVersion.id,
    taskType: 'politics-analysis',
    taskId: 'unit-politics-analysis',
    evaluationMode: 'deep-two-stage',
    usedHints: false,
    centralScore: 7.5,
    maxScore: 10,
    scoreRangeMin: 7,
    scoreRangeMax: 8,
    confidence: 'high',
    dimensionScores: [
      {
        dimensionId: 'kp',
        name: '理论原理覆盖度',
        score: 4.5,
        maxScore: 6,
        rationale: '主干原理准确，缺少对立统一转化条件说明',
      },
      {
        dimensionId: 'mat',
        name: '材料结合与论证逻辑',
        score: 3,
        maxScore: 4,
        rationale: '需进一步引用材料案例',
      },
    ],
    strengths: ['原理定位准确'],
    issues: [
      {
        category: 'principle-depth',
        description: '未展开矛盾双方转化条件',
        evidence: '共性寓于个性之中，应坚持具体问题具体分析。',
        deductionRationale: '缺少矛盾对立统一及转化条件的阐释。',
      },
    ],
    annotations: [],
    revisionTasks: [
      {
        id: 'rt-1',
        priority: 1,
        instruction: '补充矛盾双方在一定条件下相互转化的材料分析段',
        targetText: '结合材料中的产业升级条件说明转化契机',
      },
    ],
    transferableLessons: ['原理+方法论+材料案例三步展开'],
    referenceContent: '参考答案略',
    referenceContentSource: 'source-provided',
    reviewerDecision: 'approved',
    reviewerAdjustments: {
      stage1Score: 7.5,
      finalScore: 7.5,
      scoreDelta: 0,
      stabilityWarning: false,
      notes: [],
      verifiedFactCoverage: true,
    },
    modelProvider: 'gemini',
    modelName: 'gemini-2.5-flash',
    promptVersion: 'test',
    createdAt: '2026-11-14T10:00:00.000Z',
  };

  const polReviews = buildSubjectiveReviewItems(
    2101,
    'v1',
    'unit-politics-analysis',
    34,
    polV1.createdVersion.content,
    mockEval,
    '2026-11-14T10:00:00.000Z',
    'device-pol'
  );
  assert.equal(polReviews.length, 1);
  assert.equal(polReviews[0].reviewType, 're-analyze-politics');
  assert.equal(polReviews[0].paperId, 'pol-2027-xiao8-01');
  assert.equal(polReviews[0].subjectId, 'politics');
});
