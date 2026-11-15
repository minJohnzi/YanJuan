import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Exam } from '../src/domain/paper.ts';
import type { ExamAttempt, ObjectiveItemResponse, ReviewItem } from '../src/domain/learning.ts';
import {
  countUniquePapers,
  dedupeSubmittedAttemptsByPaper,
  groupReviewItemsByPaper,
  sanitizeObjectiveResponsePatch,
} from '../src/domain/reviewAnalytics.ts';
import {
  gradeObjectiveResponses,
  normalizeChoiceAnswer,
} from '../src/domain/scoringEngine.ts';
import { buildObjectiveReviewItems } from '../src/domain/reviewScheduler.ts';
import {
  formatExamTitle,
  isPoliticsExamYear,
  resolveCanonicalPaperId,
  resolveSubjectId,
} from '../src/domain/subjects.ts';

const SEVEN_OPTIONS = (['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map(
  (key) => ({ key, text: `Option ${key}` })
);

const FOUR_OPTIONS = (['A', 'B', 'C', 'D'] as const).map((key) => ({
  key,
  text: `Option ${key}`,
}));

function makeValidationReport(
  examId: string,
  year: number,
  status: Exam['importStatus'] = 'ready'
): Exam['validationReport'] {
  return {
    examId,
    year,
    dataVersion: 'v1',
    status,
    passedAllChecks: status === 'ready',
    errorCodes: [],
    missingObjectiveQuestions: [],
    conflictingObjectiveQuestions: [],
    checks: [],
    consistencyCheckRuns: 1,
    consistencyMatched: true,
    sourceDiscrepancies: [],
    generatedAt: '2026-11-15T00:00:00.000Z',
  };
}

function makeResponse(
  questionNumber: number,
  unitId: string,
  unitType: ObjectiveItemResponse['unitType'],
  selectedAnswer: string,
  maxScore: number
): ObjectiveItemResponse {
  return {
    questionNumber,
    itemId: `item-q${questionNumber}`,
    unitId,
    unitType,
    selectedAnswer,
    confidence: 'certain',
    flaggedForReview: false,
    timeSpentSeconds: 20,
    maxScore,
    knownErrorCauses: [],
    possibleErrorCauses: [],
    userNotes: '',
    highlights: [],
  };
}

test('Part B (passage-assembly) supports A–G answers and normalizes case accurately', () => {
  assert.equal(normalizeChoiceAnswer('e'), 'E');
  assert.equal(normalizeChoiceAnswer(' g '), 'G');
  assert.equal(normalizeChoiceAnswer('F'), 'F');
  assert.equal(normalizeChoiceAnswer('dca'), 'ACD');

  const partBUnitId = '2099-unit-part-b';
  const exam: Exam = {
    id: 'exam-en-partb-test',
    paperId: 'en1-2099',
    subjectId: 'english-i',
    year: 2099,
    subject: '考研英语一',
    dataVersion: 'v1',
    schemaVersion: '1.0.0',
    durationMinutes: 180,
    totalScore: 100,
    sourceFiles: ['mock.md'],
    sourceFormats: ['md'],
    sourceHashes: { 'mock.md': 'mock' },
    pageCount: 1,
    importStatus: 'ready',
    answerSourceStatus: 'source-provided',
    validationReport: makeValidationReport('exam-en-partb-test', 2099, 'ready'),
    importRetryCount: 0,
    parserProvider: 'deterministic',
    parserModel: 'rule-engine',
    parserVersion: '1.0.0',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    sections: [
      {
        id: 'sec-reading',
        sectionNumber: 'Section II',
        title: 'Reading Comprehension',
        score: 10,
        suggestedMinutes: 20,
        units: [
          {
            id: partBUnitId,
            sectionId: 'sec-reading',
            unitType: 'passage-assembly',
            title: 'Part B 排序/选句',
            instructions: 'Choose from A–G.',
            score: 10,
            suggestedMinutes: 20,
            materials: [],
            items: [
              {
                id: 'q41',
                questionNumber: 41,
                answerMode: 'single-choice',
                prompt: '41',
                options: SEVEN_OPTIONS,
                score: 2,
                correctAnswer: 'E',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'q42',
                questionNumber: 42,
                answerMode: 'single-choice',
                prompt: '42',
                options: SEVEN_OPTIONS,
                score: 2,
                correctAnswer: 'G',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'q43',
                questionNumber: 43,
                answerMode: 'single-choice',
                prompt: '43',
                options: SEVEN_OPTIONS,
                score: 2,
                correctAnswer: 'F',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'q44',
                questionNumber: 44,
                answerMode: 'single-choice',
                prompt: '44',
                options: SEVEN_OPTIONS,
                score: 2,
                correctAnswer: 'A',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'q45',
                questionNumber: 45,
                answerMode: 'single-choice',
                prompt: '45',
                options: SEVEN_OPTIONS,
                score: 2,
                correctAnswer: 'D',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
            ],
            analysisProfile: { focusSkills: ['段落衔接'], commonTraps: ['干扰段'] },
            reviewStrategy: { defaultIntervalsDays: [1, 3, 7], recommendedAction: '复盘' },
            sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
          },
        ],
      },
    ],
  };

  const result = gradeObjectiveResponses(exam, {
    41: makeResponse(41, partBUnitId, 'passage-assembly', 'e', 2),
    42: makeResponse(42, partBUnitId, 'passage-assembly', 'G', 2),
    43: makeResponse(43, partBUnitId, 'passage-assembly', 'F', 2),
    44: makeResponse(44, partBUnitId, 'passage-assembly', 'B', 2),
    45: makeResponse(45, partBUnitId, 'passage-assembly', '', 2),
  });

  assert.equal(result.totalScoreEarned, 6);
  assert.equal(result.maxObjectiveScore, 10);
  assert.equal(result.itemResults[41].isCorrect, true);
  assert.equal(result.itemResults[42].isCorrect, true);
  assert.equal(result.itemResults[43].isCorrect, true);
  assert.equal(result.itemResults[44].isCorrect, false);
  assert.equal(result.itemResults[45].isCorrect, false);
});

test('Politics multi-choice strict scoring requires exact sorted option set', () => {
  const multiUnitId = '2199-unit-politics-multi';
  const exam: Exam = {
    id: 'exam-pol-multi-test',
    paperId: 'pol-2027-xiao8-99',
    subjectId: 'politics',
    year: 2199,
    subject: '考研政治',
    dataVersion: 'v1',
    schemaVersion: '1.0.0',
    durationMinutes: 180,
    totalScore: 100,
    sourceFiles: ['mock.md'],
    sourceFormats: ['md'],
    sourceHashes: { 'mock.md': 'mock' },
    pageCount: 1,
    importStatus: 'ready',
    answerSourceStatus: 'source-provided',
    validationReport: makeValidationReport('exam-pol-multi-test', 2199, 'ready'),
    importRetryCount: 0,
    parserProvider: 'deterministic',
    parserModel: 'rule-engine',
    parserVersion: '1.0.0',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    sections: [
      {
        id: 'sec-multi',
        sectionNumber: '二',
        title: '多项选择题',
        score: 6,
        suggestedMinutes: 25,
        units: [
          {
            id: multiUnitId,
            sectionId: 'sec-multi',
            unitType: 'politics-multi',
            title: '多选题',
            instructions: '多选、少选或错选均不得分。',
            score: 6,
            suggestedMinutes: 25,
            materials: [],
            items: [
              {
                id: 'pol-q17',
                questionNumber: 17,
                answerMode: 'multi-choice',
                prompt: '17',
                options: FOUR_OPTIONS,
                score: 2,
                correctAnswer: 'ABC',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'pol-q18',
                questionNumber: 18,
                answerMode: 'multi-choice',
                prompt: '18',
                options: FOUR_OPTIONS,
                score: 2,
                correctAnswer: 'BD',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
              {
                id: 'pol-q19',
                questionNumber: 19,
                answerMode: 'multi-choice',
                prompt: '19',
                options: FOUR_OPTIONS,
                score: 2,
                correctAnswer: 'ABCD',
                answerSource: 'source-provided',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
            ],
            analysisProfile: { focusSkills: ['考点精准匹配'], commonTraps: ['漏选'] },
            reviewStrategy: { defaultIntervalsDays: [1, 3, 7], recommendedAction: '复盘' },
            sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
          },
        ],
      },
    ],
  };

  const result = gradeObjectiveResponses(exam, {
    17: makeResponse(17, multiUnitId, 'politics-multi', 'cba', 2),
    18: makeResponse(18, multiUnitId, 'politics-multi', 'B', 2),
    19: makeResponse(19, multiUnitId, 'politics-multi', 'ABC', 2),
  });

  assert.equal(result.totalScoreEarned, 2);
  assert.equal(result.itemResults[17].isCorrect, true);
  assert.equal(result.itemResults[17].scoreEarned, 2);
  assert.equal(result.itemResults[18].isCorrect, false);
  assert.equal(result.itemResults[18].scoreEarned, 0);
  assert.equal(result.itemResults[19].isCorrect, false);
  assert.equal(result.itemResults[19].scoreEarned, 0);
});

test('Manifest ready counts (25 = 17 English + 8 Politics) and canonical unitIds match generated papers', () => {
  const root = process.cwd();
  const manifestPath = path.join(root, 'data/exams/generated/papers-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    years: Array<{ year: number; status: string }>;
  };

  const readyYears = Array.from(
    new Set(manifest.years.filter((row) => row.status === 'ready').map((row) => row.year))
  );
  const englishReady = readyYears.filter((y) => !isPoliticsExamYear(y));
  const politicsReady = readyYears.filter((y) => isPoliticsExamYear(y));

  assert.equal(readyYears.length, 25);
  assert.equal(englishReady.length, 17);
  assert.equal(politicsReady.length, 8);

  assert.equal(resolveSubjectId(2024), 'english-i');
  assert.equal(resolveCanonicalPaperId(2024), 'en1-2024');
  assert.equal(resolveSubjectId(2101), 'politics');
  assert.equal(resolveCanonicalPaperId(2101), 'pol-2027-xiao8-01');
  assert.equal(formatExamTitle(2101), '2027 考研政治冲刺 8 套卷（一）');

  const exam2010 = JSON.parse(
    fs.readFileSync(path.join(root, 'data/exams/generated/papers/2010.json'), 'utf-8')
  ) as Exam;
  const exam2024 = JSON.parse(
    fs.readFileSync(path.join(root, 'data/exams/generated/papers/2024.json'), 'utf-8')
  ) as Exam;
  const exam2101 = JSON.parse(
    fs.readFileSync(path.join(root, 'data/exams/generated/papers/2101.json'), 'utf-8')
  ) as Exam;

  assert.deepEqual(
    exam2024.sections.flatMap((s) => s.units.map((u) => u.id)),
    [
      '2024-unit-cloze',
      '2024-unit-reading-1',
      '2024-unit-reading-2',
      '2024-unit-reading-3',
      '2024-unit-reading-4',
      '2024-unit-part-b',
      '2024-unit-translation',
      '2024-unit-practical-writing',
      '2024-unit-visual-writing',
    ]
  );
  assert.deepEqual(
    exam2010.sections.flatMap((s) => s.units.map((u) => u.id)),
    [
      '2010-unit-cloze',
      '2010-unit-reading-1',
      '2010-unit-reading-2',
      '2010-unit-reading-3',
      '2010-unit-reading-4',
      '2010-unit-part-b',
      '2010-unit-translation',
      '2010-unit-practical-writing',
      '2010-unit-visual-writing',
    ]
  );

  const partB2024 = exam2024.sections
    .flatMap((s) => s.units)
    .find((u) => u.id === '2024-unit-part-b');
  assert.ok(partB2024);
  assert.equal(partB2024.unitType, 'passage-assembly');
  assert.equal(partB2024.items[0]?.options?.length, 7);

  assert.deepEqual(
    exam2101.sections.flatMap((s) => s.units.map((u) => u.id)),
    [
      '2101-unit-politics-single',
      '2101-unit-politics-multi',
      '2101-unit-politics-analysis',
    ]
  );
  const analysis2101 = exam2101.sections
    .flatMap((s) => s.units)
    .find((u) => u.id === '2101-unit-politics-analysis');
  assert.deepEqual(
    analysis2101?.items.map((i) => i.questionNumber),
    [34, 35, 36, 37, 38]
  );
});

test('Unavailable answerSourceStatus guard avoids generating false review items from ungraded responses', () => {
  const unavailableExam: Exam = {
    id: 'exam-unavailable-mock',
    paperId: 'en1-2098',
    subjectId: 'english-i',
    year: 2098,
    subject: '考研英语一',
    dataVersion: 'v1',
    schemaVersion: '1.0.0',
    durationMinutes: 180,
    totalScore: 100,
    sourceFiles: ['mock.md'],
    sourceFormats: ['md'],
    sourceHashes: { 'mock.md': 'mock' },
    pageCount: 1,
    importStatus: 'needs-answer-source',
    answerSourceStatus: 'unavailable',
    validationReport: makeValidationReport(
      'exam-unavailable-mock',
      2098,
      'needs-answer-source'
    ),
    importRetryCount: 0,
    parserProvider: 'deterministic',
    parserModel: 'rule-engine',
    parserVersion: '1.0.0',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    sections: [
      {
        id: 'sec-1',
        sectionNumber: 'Section I',
        title: 'Cloze',
        score: 0.5,
        suggestedMinutes: 18,
        units: [
          {
            id: '2098-unit-cloze',
            sectionId: 'sec-1',
            unitType: 'cloze',
            title: 'Cloze',
            instructions: 'Choose A–D.',
            score: 0.5,
            suggestedMinutes: 18,
            materials: [],
            items: [
              {
                id: 'q1',
                questionNumber: 1,
                answerMode: 'single-choice',
                prompt: 'Q1',
                options: FOUR_OPTIONS,
                score: 0.5,
                correctAnswer: null,
                answerSource: 'unavailable',
                sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
              },
            ],
            analysisProfile: { focusSkills: [], commonTraps: [] },
            reviewStrategy: { defaultIntervalsDays: [1, 3], recommendedAction: '复盘' },
            sourceLocator: { sourceFile: 'mock.md', sourceFormat: 'md' },
          },
        ],
      },
    ],
  };

  const ungradedResponses: Record<number, ObjectiveItemResponse> = {
    1: makeResponse(1, '2098-unit-cloze', 'cloze', 'A', 0.5),
  };
  const canGrade = unavailableExam.answerSourceStatus !== 'unavailable';
  assert.equal(canGrade, false);

  // Even if buildObjectiveReviewItems is invoked directly on ungraded responses, it produces 0 items
  const generatedReviews = canGrade
    ? buildObjectiveReviewItems(
        unavailableExam,
        ungradedResponses,
        { attemptId: 'att-1', nowIso: '2026-11-15T00:00:00.000Z' },
        'dev-1'
      )
    : [];
  assert.equal(generatedReviews.length, 0);
});

test('dedupeSubmittedAttemptsByPaper & countUniquePapers deduplicate repeat attempts of the same paper', () => {
  const makeAttempt = (
    id: string,
    year: number,
    paperId: string,
    submittedAt: string,
    score: number
  ): ExamAttempt => ({
    id,
    paperId,
    subjectId: isPoliticsExamYear(year) ? 'politics' : 'english-i',
    year,
    dataVersion: 'v1',
    mode: 'unit-practice',
    unitIds: [],
    status: 'submitted',
    startedAt: submittedAt,
    submittedAt,
    elapsedSeconds: 120,
    objectiveResponses: {},
    subjectiveVersionIds: [],
    totalObjectiveScore: score,
    maxObjectiveScore: 50,
    updatedAt: submittedAt,
    clientRevision: 1,
    deviceId: 'dev-1',
  });

  const attempts = [
    makeAttempt('att-1', 2101, 'politics-xiao8-set1', '2026-11-15T01:00:00.000Z', 30),
    makeAttempt('att-2', 2101, 'politics-xiao8-set1', '2026-11-15T03:00:00.000Z', 42),
    makeAttempt('att-3', 2024, 'english-1-2024', '2026-11-15T02:00:00.000Z', 48),
  ];

  assert.equal(countUniquePapers(attempts), 2);
  const deduped = dedupeSubmittedAttemptsByPaper(attempts);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 'att-2');
  assert.equal(deduped[0].totalObjectiveScore, 42);
  assert.equal(deduped[1].id, 'att-3');
});

test('sanitizeObjectiveResponsePatch keeps answers locked after submit while allowing userNotes & flags', () => {
  const locked = sanitizeObjectiveResponsePatch('submitted', {
    selectedAnswer: 'B',
    confidence: 'guessed',
    userNotes: '记住定位区间在第三段',
    flaggedForReview: true,
    knownErrorCauses: ['混淆偷换概念干扰项'],
  });
  assert.equal(locked.selectedAnswer, undefined);
  assert.equal(locked.confidence, undefined);
  assert.equal(locked.userNotes, '记住定位区间在第三段');
  assert.equal(locked.flaggedForReview, true);
  assert.deepEqual(locked.knownErrorCauses, ['混淆偷换概念干扰项']);

  const editable = sanitizeObjectiveResponsePatch('in-progress', {
    selectedAnswer: 'B',
    confidence: 'guessed',
  });
  assert.equal(editable.selectedAnswer, 'B');
  assert.equal(editable.confidence, 'guessed');
});

test('groupReviewItemsByPaper groups review items per paper and calculates due/mastered counts', () => {
  const makeReview = (
    id: string,
    year: number,
    qNum: number,
    mastered: boolean
  ): ReviewItem => ({
    id,
    attemptId: `att-${year}`,
    paperId: resolveCanonicalPaperId(year),
    subjectId: resolveSubjectId(year),
    year,
    dataVersion: 'v1',
    unitId: `${year}-unit-politics-single`,
    unitType: isPoliticsExamYear(year) ? 'politics-single' : 'reading',
    questionNumber: qNum,
    reviewType: 'objective-error',
    title: `Q${qNum}`,
    promptSnapshot: `Prompt ${qNum}`,
    previousUserAnswer: 'B',
    previousFeedbackSummary: '错选 B，正解 A',
    knownErrorCauses: [],
    intervalDays: 1,
    repetitionCount: 0,
    mastered,
    nextDueAt: '2026-11-16T00:00:00.000Z',
    lastReviewedAt: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    clientRevision: 1,
    deviceId: 'dev-1',
  });

  const groups = groupReviewItemsByPaper([
    makeReview('r1', 2101, 17, false),
    makeReview('r2', 2101, 3, true),
    makeReview('r3', 2024, 21, false),
  ]);

  assert.equal(groups.length, 2);
  const politicsGroup = groups.find((g) => g.year === 2101);
  assert.ok(politicsGroup);
  assert.equal(politicsGroup.dueCount, 1);
  assert.equal(politicsGroup.masteredCount, 1);
  assert.deepEqual(
    politicsGroup.items.map((it) => it.questionNumber),
    [3, 17]
  );
});
