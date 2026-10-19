import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { Exam } from '../src/shared/types.ts';
import {
  appendSubjectiveAnswerVersion,
  createDefaultLearningDatabase,
  exportLearningDataJson,
  importLearningDataJson,
  mergeLearningDatabasesWithConflictDetection,
} from '../src/services/storageAndSync.ts';
import {
  evaluateFirestoreRuleRequest,
  loadFirestoreRulesFromDisk,
} from '../src/shared/firestoreRulesEvaluator.ts';
import { computeVersionDiff } from '../src/shared/schemaValidator.ts';
import {
  buildObjectiveReviewItems,
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

test('Firestore Security Rules pass all Dirty Dozen adversarial checks and enforce user isolation', () => {
  const rulesText = loadFirestoreRulesFromDisk(path.join(process.cwd(), 'firestore.rules'));

  // 1. Unauthenticated read -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: null,
      operation: 'get',
      path: '/users/user_a/attempts/att_1',
    }).allowed,
    false
  );

  // 2. Cross-user read (IDOR) -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: { uid: 'user_b', email_verified: true },
      operation: 'get',
      path: '/users/user_a/attempts/att_1',
    }).allowed,
    false
  );

  // 3. Unverified email write -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: { uid: 'user_a', email_verified: false },
      operation: 'create',
      path: '/users/user_a/attempts/att_1',
      incomingData: { id: 'att_1', uid: 'user_a' },
    }).allowed,
    false
  );

  // 4. Subjective answer version in-place update -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: { uid: 'user_a', email_verified: true },
      operation: 'update',
      path: '/users/user_a/answer-versions/ver_1',
      incomingData: { id: 'ver_1', uid: 'user_a', content: 'modified' },
    }).allowed,
    false
  );

  // 5. Client read/write on /private-provider-credentials -> PERMISSION_DENIED
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: { uid: 'user_a', email_verified: true },
      operation: 'get',
      path: '/private-provider-credentials/user_a/providers/gemini',
    }).allowed,
    false
  );
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: { uid: 'user_a', email_verified: true },
      operation: 'create',
      path: '/private-provider-credentials/user_a/providers/gemini',
      incomingData: { provider: 'gemini', ciphertext: 'abc' },
    }).allowed,
    false
  );

  // 6. Legitimate owner create & read -> ALLOWED
  assert.equal(
    evaluateFirestoreRuleRequest(rulesText, {
      auth: { uid: 'user_a', email_verified: true },
      operation: 'create',
      path: '/users/user_a/answer-versions/ver_1',
      incomingData: {
        id: 'ver_1',
        uid: 'user_a',
        year: 2010,
        dataVersion: 'v2',
        questionNumber: 51,
        versionNumber: 1,
        practiceMode: 'independent',
        content: 'Notice...',
        createdAt: '2026-10-19T00:00:00Z',
      },
    }).allowed,
    true
  );
});
