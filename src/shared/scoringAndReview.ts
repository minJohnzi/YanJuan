import type {
  ConfidenceLevel,
  Exam,
  ExamItem,
  ObjectiveItemResponse,
  ReviewItem,
  ReviewItemType,
  SubjectiveEvaluationResult,
} from './types.ts';

export const DEFAULT_REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;

export interface ObjectiveScoringSummary {
  totalScoreEarned: number;
  maxObjectiveScore: number;
  correctCount: number;
  totalQuestions: number;
  accuracyPercent: number;
  byConfidence: Record<
    ConfidenceLevel,
    { total: number; correct: number; wrong: number }
  >;
  confidentButWrongQuestions: number[];
  hesitantWrongQuestions: number[];
  guessedRightQuestions: number[];
  itemResults: Record<number, ObjectiveItemResponse>;
}

/**
 * Deterministically grades objective responses against an Exam's verified items.
 * Never guesses missing answers; throws if called on an exam with unavailable objective answers.
 */
export function gradeObjectiveResponses(
  exam: Exam,
  responses: Record<number, ObjectiveItemResponse>
): ObjectiveScoringSummary {
  const itemMap = new Map<number, { item: ExamItem; unitId: string; unitType: ExamItem['answerMode'] extends string ? any : any }>();

  for (const section of exam.sections) {
    for (const unit of section.units) {
      if (unit.unitType === 'cloze' || unit.unitType === 'reading' || unit.unitType === 'passage-assembly') {
        for (const item of unit.items) {
          itemMap.set(item.questionNumber, { item, unitId: unit.id, unitType: unit.unitType });
        }
      }
    }
  }

  let totalScoreEarned = 0;
  let maxObjectiveScore = 0;
  let correctCount = 0;
  let totalQuestions = 0;

  const byConfidence: Record<ConfidenceLevel, { total: number; correct: number; wrong: number }> = {
    certain: { total: 0, correct: 0, wrong: 0 },
    hesitant: { total: 0, correct: 0, wrong: 0 },
    guessed: { total: 0, correct: 0, wrong: 0 },
  };

  const confidentButWrongQuestions: number[] = [];
  const hesitantWrongQuestions: number[] = [];
  const guessedRightQuestions: number[] = [];
  const itemResults: Record<number, ObjectiveItemResponse> = {};

  for (const [qNum, entry] of itemMap.entries()) {
    const { item, unitId, unitType } = entry;
    if (!item.correctAnswer || item.answerSource !== 'source-provided') {
      throw new Error(`OBJECTIVE_ANSWER_MISSING: 第 ${qNum} 题缺少来源客观答案，禁止正式评分`);
    }

    const userResp = responses[qNum];
    if (!userResp) continue;

    totalQuestions++;
    maxObjectiveScore += item.score;

    const normalizedUser = (userResp.selectedAnswer || '').trim().toUpperCase();
    const normalizedCorrect = item.correctAnswer.trim().toUpperCase();
    const isCorrect = normalizedUser.length > 0 && normalizedUser === normalizedCorrect;
    const scoreEarned = isCorrect ? item.score : 0;

    if (isCorrect) {
      totalScoreEarned += scoreEarned;
      correctCount++;
    }

    const conf: ConfidenceLevel = userResp.confidence || 'certain';
    byConfidence[conf].total++;
    if (isCorrect) {
      byConfidence[conf].correct++;
      if (conf === 'guessed') {
        guessedRightQuestions.push(qNum);
      }
    } else {
      byConfidence[conf].wrong++;
      if (conf === 'certain') {
        confidentButWrongQuestions.push(qNum);
      } else if (conf === 'hesitant') {
        hesitantWrongQuestions.push(qNum);
      }
    }

    // Generate heuristic possible error causes (strictly labeled as possibleErrorCauses, never knownErrorCauses)
    const possibleErrorCauses =
      userResp.possibleErrorCauses && userResp.possibleErrorCauses.length > 0
        ? userResp.possibleErrorCauses
        : isCorrect
        ? conf === 'guessed'
          ? ['虽蒙对选项，但可能对长难句主干或同义替换缺乏确定性证据定位']
          : []
        : inferPossibleErrorCauses(unitType, conf);

    itemResults[qNum] = {
      ...userResp,
      unitId,
      unitType,
      isCorrect,
      correctAnswer: normalizedCorrect,
      scoreEarned,
      maxScore: item.score,
      knownErrorCauses: userResp.knownErrorCauses || [],
      possibleErrorCauses,
    };
  }

  totalScoreEarned = Math.round(totalScoreEarned * 10) / 10;
  maxObjectiveScore = Math.round(maxObjectiveScore * 10) / 10;
  const accuracyPercent =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 1000) / 10 : 0;

  return {
    totalScoreEarned,
    maxObjectiveScore,
    correctCount,
    totalQuestions,
    accuracyPercent,
    byConfidence,
    confidentButWrongQuestions,
    hesitantWrongQuestions,
    guessedRightQuestions,
    itemResults,
  };
}

function inferPossibleErrorCauses(unitType: string, confidence: ConfidenceLevel): string[] {
  const causes: string[] = [];
  if (unitType === 'cloze') {
    causes.push('可能忽略了上下文逻辑衔接词或固定搭配辨析');
  } else if (unitType === 'reading') {
    causes.push('可能落入原文词汇复现但偷换概念的干扰项陷阱');
  } else if (unitType === 'passage-assembly') {
    causes.push('可能未抓住段首代词指代或段落首尾过渡衔接线索');
  }
  if (confidence === 'certain') {
    causes.push('可能对定位句局部信息进行了过度推理（建议核对原文证据句）');
  } else if (confidence === 'hesitant') {
    causes.push('可能在两个近似选项间未依据主旨句完成排除');
  }
  return causes;
}

/**
 * Automatically creates review items from graded objective responses.
 */
export function buildObjectiveReviewItems(
  exam: Exam,
  gradedResponses: Record<number, ObjectiveItemResponse>,
  nowIso: string = new Date().toISOString(),
  deviceId: string = 'local-device'
): ReviewItem[] {
  const itemsByNumber = new Map<number, ExamItem>();
  for (const sec of exam.sections) {
    for (const unit of sec.units) {
      for (const item of unit.items) {
        itemsByNumber.set(item.questionNumber, item);
      }
    }
  }

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
      id: `rev-obj-${exam.year}-${exam.dataVersion}-q${resp.questionNumber}`,
      year: exam.year,
      dataVersion: exam.dataVersion,
      unitId: resp.unitId,
      unitType: resp.unitType,
      questionNumber: resp.questionNumber,
      reviewType,
      title: `${exam.year}年 第${resp.questionNumber}题 (${formatReviewTypeLabel(reviewType)})`,
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
  nowIso: string = new Date().toISOString(),
  deviceId: string = 'local-device'
): ReviewItem[] {
  const nextDue = new Date(new Date(nowIso).getTime() + 86400 * 1000).toISOString();
  const items: ReviewItem[] = [];

  const primaryType: ReviewItemType =
    evaluation.taskType === 'translation' ? 're-translate' : 'revise-essay';

  items.push({
    id: `rev-subj-${year}-${dataVersion}-q${questionNumber}-${evaluation.answerVersionId}`,
    year,
    dataVersion,
    unitId,
    unitType: evaluation.taskType,
    questionNumber,
    reviewType: primaryType,
    title:
      evaluation.taskType === 'translation'
        ? `${year}年 翻译第${questionNumber}题 盲译复盘`
        : `${year}年 写作第${questionNumber}题 升格改写`,
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
      id: `rev-sent-${year}-${dataVersion}-q${questionNumber}-${evaluation.answerVersionId}`,
      year,
      dataVersion,
      unitId,
      unitType: evaluation.taskType,
      questionNumber,
      reviewType: 'fix-sentence',
      title: `${year}年 第${questionNumber}题 病句靶向修复`,
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
 * Intervals: [1, 3, 7, 14, 30] days.
 * - If correct/completed AND confirmedMastery is true -> advance to next interval (or mark mastered at 30d).
 * - If incorrect/repeated error -> reset or step back interval to 1 day.
 */
export function calculateNextReviewSchedule(
  item: ReviewItem,
  passed: boolean,
  confirmedMastery: boolean,
  customIntervals: readonly number[] = DEFAULT_REVIEW_INTERVALS_DAYS,
  nowIso: string = new Date().toISOString()
): ReviewItem {
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
    'rewrite-paragraph': '重写指定段落',
    'fix-sentence': '修复指定句子',
    'restructure-outline': '重组提纲',
    'delayed-full-rewrite': '延时整篇重写',
    'recurring-language-issue': '高频语言问题',
  };
  return map[type] || type;
}
