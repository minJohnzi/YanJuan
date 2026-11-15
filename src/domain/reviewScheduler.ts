/**
 * Spaced-repetition review queue generator and scheduler.
 * Guards all timestamp calculations against invalid date inputs.
 */

import type {
  ObjectiveItemResponse,
  ReviewItem,
  ReviewItemType,
  SubjectiveEvaluationResult,
} from './learning.ts';
import type { Exam, ExamItem } from './paper.ts';
import {
  formatExamTitle,
  resolveCanonicalPaperId,
  resolveSubjectId,
} from './subjects.ts';

export const DEFAULT_REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;

export interface BuildObjectiveReviewOptions {
  attemptId?: string;
  nowIso?: string;
  deviceId?: string;
}

export function resolveSafeIsoTimestamp(candidate?: string): string {
  if (candidate && /^\d{4}-\d{2}-\d{2}T/.test(candidate)) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (candidate) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime()) && !/^\d+$/.test(candidate.trim())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Automatically creates review items from graded objective responses.
 * Safely handles both BuildObjectiveReviewOptions and legacy nowIso string callers
 * (preventing RangeError: Invalid time value if an attemptId string was passed).
 */
export function buildObjectiveReviewItems(
  exam: Exam,
  gradedResponses: Record<number, ObjectiveItemResponse>,
  optionsOrNowIso: BuildObjectiveReviewOptions | string = {},
  deviceIdArg: string = 'local-device'
): ReviewItem[] {
  const attemptId =
    typeof optionsOrNowIso === 'object' && optionsOrNowIso.attemptId
      ? optionsOrNowIso.attemptId.trim()
      : undefined;
  const nowIso =
    typeof optionsOrNowIso === 'string'
      ? resolveSafeIsoTimestamp(optionsOrNowIso)
      : resolveSafeIsoTimestamp(optionsOrNowIso.nowIso);
  const deviceId =
    typeof optionsOrNowIso === 'object' && optionsOrNowIso.deviceId
      ? optionsOrNowIso.deviceId
      : deviceIdArg;

  const itemsByNumber = new Map<number, ExamItem>();
  for (const sec of exam.sections) {
    for (const unit of sec.units) {
      for (const item of unit.items) {
        itemsByNumber.set(item.questionNumber, item);
      }
    }
  }

  const paperId = exam.paperId || resolveCanonicalPaperId(exam.year);
  const subjectId = exam.subjectId || resolveSubjectId(paperId);
  const reviewItems: ReviewItem[] = [];
  const nextDue = new Date(new Date(nowIso).getTime() + 86400 * 1000).toISOString();

  for (const resp of Object.values(gradedResponses)) {
    const examItem = itemsByNumber.get(resp.questionNumber);
    if (!examItem) continue;

    let reviewType: ReviewItemType | null = null;
    if (!resp.isCorrect) {
      if (resp.confidence === 'certain') {
        reviewType = 'objective-confident-error';
      } else if (resp.confidence === 'hesitant') {
        reviewType = 'objective-hesitant-error';
      } else {
        reviewType = 'objective-error';
      }
    } else if (resp.confidence === 'guessed') {
      reviewType = 'objective-guessed-right';
    } else if (resp.flaggedForReview) {
      reviewType = 'objective-manual';
    }

    if (!reviewType) continue;

    reviewItems.push({
      id: attemptId
        ? `rev-obj-${paperId}-${attemptId}-q${resp.questionNumber}`
        : `rev-obj-${paperId}-${exam.dataVersion}-q${resp.questionNumber}`,
      attemptId,
      paperId,
      subjectId,
      year: exam.year,
      dataVersion: exam.dataVersion,
      unitId: resp.unitId,
      unitType: resp.unitType,
      questionNumber: resp.questionNumber,
      reviewType,
      title: `${formatExamTitle(paperId, 'short')} 第${resp.questionNumber}题 (${formatReviewTypeLabel(reviewType)})`,
      promptSnapshot: examItem.prompt,
      optionsSnapshot: examItem.options,
      correctAnswerSnapshot: examItem.correctAnswer,
      previousUserAnswer: resp.selectedAnswer || '未作答',
      previousFeedbackSummary: resp.isCorrect
        ? '上次作答猜对，需巩固原文证据链与排除依据'
        : `上次误选 ${resp.selectedAnswer || '空'}，正确答案为 ${examItem.correctAnswer}`,
      knownErrorCauses: resp.knownErrorCauses,
      intervalDays: DEFAULT_REVIEW_INTERVALS_DAYS[0],
      repetitionCount: 0,
      mastered: false,
      nextDueAt: nextDue,
      lastReviewedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      clientRevision: 1,
      deviceId,
    });
  }

  return reviewItems;
}

/**
 * Generates targeted subjective review items from an AI evaluation result.
 */
export function buildSubjectiveReviewItems(
  year: number,
  dataVersion: string,
  unitId: string,
  questionNumber: number,
  userAnswer: string,
  evaluation: SubjectiveEvaluationResult,
  nowIsoInput: string = new Date().toISOString(),
  deviceId: string = 'local-device'
): ReviewItem[] {
  const nowIso = resolveSafeIsoTimestamp(nowIsoInput);
  const nextDue = new Date(new Date(nowIso).getTime() + 86400 * 1000).toISOString();
  const paperId = resolveCanonicalPaperId(year);
  const subjectId = resolveSubjectId(paperId);
  const shortTitle = formatExamTitle(paperId, 'short');
  const items: ReviewItem[] = [];

  const primaryType: ReviewItemType =
    evaluation.taskType === 'translation'
      ? 're-translate'
      : evaluation.taskType === 'politics-analysis'
      ? 're-analyze-politics'
      : 'revise-essay';

  const primaryTitle =
    evaluation.taskType === 'translation'
      ? `${shortTitle} 翻译第${questionNumber}题 盲译复盘`
      : evaluation.taskType === 'politics-analysis'
      ? `${shortTitle} 材料分析第${questionNumber}题 思路重构`
      : `${shortTitle} 写作第${questionNumber}题 升格改写`;

  items.push({
    id: `rev-subj-${paperId}-${dataVersion}-q${questionNumber}-${evaluation.answerVersionId}`,
    paperId,
    subjectId,
    year,
    dataVersion,
    unitId,
    unitType: evaluation.taskType,
    questionNumber,
    reviewType: primaryType,
    title: primaryTitle,
    promptSnapshot:
      evaluation.revisionTasks.map((t) => t.instruction).join('；') ||
      '结合批改任务重新独立完成并对比差异',
    previousUserAnswer: userAnswer,
    previousFeedbackSummary: `AI参考分 ${evaluation.centralScore}/${evaluation.maxScore}；待修复问题：${evaluation.issues
      .map((i) => i.description)
      .slice(0, 2)
      .join('；')}`,
    knownErrorCauses: evaluation.issues.map((i) => i.category),
    intervalDays: DEFAULT_REVIEW_INTERVALS_DAYS[0],
    repetitionCount: 0,
    mastered: false,
    nextDueAt: nextDue,
    lastReviewedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    clientRevision: 1,
    deviceId,
  });

  if (evaluation.annotations.length > 0) {
    const firstAnn = evaluation.annotations[0];
    items.push({
      id: `rev-sent-${paperId}-${dataVersion}-q${questionNumber}-${evaluation.answerVersionId}`,
      paperId,
      subjectId,
      year,
      dataVersion,
      unitId,
      unitType: evaluation.taskType,
      questionNumber,
      reviewType: 'fix-sentence',
      title: `${shortTitle} 第${questionNumber}题 靶向表述修复`,
      promptSnapshot: `请针对原句片段「${firstAnn.quotedUserText}」进行改写修复`,
      previousUserAnswer: firstAnn.quotedUserText,
      previousFeedbackSummary: `${firstAnn.explanation}（建议：${firstAnn.suggestion}）`,
      knownErrorCauses: [firstAnn.issueType],
      intervalDays: DEFAULT_REVIEW_INTERVALS_DAYS[0],
      repetitionCount: 0,
      mastered: false,
      nextDueAt: nextDue,
      lastReviewedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      clientRevision: 1,
      deviceId,
    });
  }

  return items;
}

/**
 * Updates spaced repetition interval based on review outcome.
 */
export function calculateNextReviewSchedule(
  item: ReviewItem,
  passed: boolean,
  confirmedMastery: boolean,
  customIntervals: readonly number[] = DEFAULT_REVIEW_INTERVALS_DAYS,
  nowIsoInput: string = new Date().toISOString()
): ReviewItem {
  const nowIso = resolveSafeIsoTimestamp(nowIsoInput);
  const intervals = customIntervals.length > 0 ? customIntervals : DEFAULT_REVIEW_INTERVALS_DAYS;
  const currentIdx = intervals.findIndex((d) => d >= item.intervalDays);
  const resolvedIdx = currentIdx === -1 ? 0 : currentIdx;

  let nextIntervalDays = intervals[0];
  let mastered = false;
  let repetitionCount = item.repetitionCount;

  if (passed) {
    repetitionCount += 1;
    if (confirmedMastery) {
      const nextIdx = Math.min(intervals.length - 1, resolvedIdx + 1);
      nextIntervalDays = intervals[nextIdx];
      if (resolvedIdx === intervals.length - 1) {
        mastered = true;
      }
    } else {
      nextIntervalDays = intervals[resolvedIdx];
    }
  } else {
    repetitionCount = Math.max(0, repetitionCount - 1);
    const prevIdx = Math.max(0, resolvedIdx - 1);
    nextIntervalDays = intervals[prevIdx];
    mastered = false;
  }

  const nextDueAt = new Date(
    new Date(nowIso).getTime() + nextIntervalDays * 86400 * 1000
  ).toISOString();

  return {
    ...item,
    intervalDays: nextIntervalDays,
    repetitionCount,
    mastered,
    lastReviewedAt: nowIso,
    nextDueAt,
    updatedAt: nowIso,
    clientRevision: item.clientRevision + 1,
  };
}

export function formatReviewTypeLabel(type: ReviewItemType): string {
  const map: Record<ReviewItemType, string> = {
    'objective-error': '答错复盘',
    'objective-hesitant-error': '犹豫后答错',
    'objective-confident-error': '自信但答错',
    'objective-guessed-right': '猜对巩固',
    'objective-manual': '手动收藏',
    're-translate': '重新翻译',
    'revise-essay': '修改作文',
    're-analyze-politics': '分析题重练',
    'rewrite-paragraph': '重写指定段落',
    'fix-sentence': '修复指定句子',
    'restructure-outline': '重组提纲',
    'delayed-full-rewrite': '延时整篇重写',
    'recurring-language-issue': '高频语言问题',
  };
  return map[type] || type;
}
