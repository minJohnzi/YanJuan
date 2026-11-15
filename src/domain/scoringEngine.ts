/**
 * Deterministic objective scoring engine across all supported exam subjects.
 */

import type { ConfidenceLevel, ObjectiveItemResponse } from './learning.ts';
import type { Exam, ExamItem } from './paper.ts';
import type { UnitType } from './subjects.ts';

export function normalizeChoiceAnswer(raw: string, isMulti?: boolean): string {
  const letters = Array.from(
    new Set(
      (raw || '')
        .toUpperCase()
        .replace(/[^A-G]/g, '')
        .split('')
    )
  ).sort();
  if (isMulti === false) {
    return letters[0] || '';
  }
  return letters.join('');
}

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

const OBJECTIVE_UNIT_TYPES = new Set<UnitType>([
  'cloze',
  'reading',
  'passage-assembly',
  'politics-single',
  'politics-multi',
]);

/**
 * Deterministically grades objective responses against an Exam's verified items.
 * Never guesses missing answers; throws if called on an exam with unavailable objective answers.
 */
export function gradeObjectiveResponses(
  exam: Exam,
  responses: Record<number, ObjectiveItemResponse>
): ObjectiveScoringSummary {
  const itemMap = new Map<number, { item: ExamItem; unitId: string; unitType: UnitType }>();

  for (const section of exam.sections) {
    for (const unit of section.units) {
      if (OBJECTIVE_UNIT_TYPES.has(unit.unitType)) {
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

    const isMulti = item.answerMode === 'multi-choice' || unitType === 'politics-multi';
    const normalizedUser = isMulti
      ? normalizeChoiceAnswer(userResp.selectedAnswer || '')
      : (userResp.selectedAnswer || '').trim().toUpperCase();
    const normalizedCorrect = isMulti
      ? normalizeChoiceAnswer(item.correctAnswer)
      : item.correctAnswer.trim().toUpperCase();
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

    const possibleErrorCauses =
      userResp.possibleErrorCauses && userResp.possibleErrorCauses.length > 0
        ? userResp.possibleErrorCauses
        : isCorrect
        ? conf === 'guessed'
          ? ['虽蒙对选项，但可能对核心考点或排除依据缺乏确定性把握']
          : []
        : inferPossibleErrorCauses(unitType, conf, normalizedUser, normalizedCorrect);

    itemResults[qNum] = {
      ...userResp,
      selectedAnswer: normalizedUser,
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

export function inferPossibleErrorCauses(
  unitType: string,
  confidence: ConfidenceLevel,
  normalizedUser?: string,
  normalizedCorrect?: string
): string[] {
  const causes: string[] = [];
  if (unitType === 'politics-multi' && normalizedUser && normalizedCorrect) {
    const userSet = new Set(normalizedUser.split(''));
    const correctSet = new Set(normalizedCorrect.split(''));
    const missing = [...correctSet].filter((c) => !userSet.has(c));
    const extra = [...userSet].filter((c) => !correctSet.has(c));
    if (extra.length === 0 && missing.length > 0) {
      causes.push(`多选漏选（保守失分）：所选均正确，但漏选了 ${missing.join('、')}`);
    } else if (missing.length === 0 && extra.length > 0) {
      causes.push(`多选误选干扰项：已包含全部正确项，但多选了 ${extra.join('、')}`);
    } else {
      causes.push(`多选错漏并存：误选 ${extra.join('、')}，漏选 ${missing.join('、')}`);
    }
    return causes;
  }
  if (unitType === 'politics-single') {
    causes.push('可能混淆了相近政治概念、历史时间节点或“帽子题”固定表述');
    return causes;
  }
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
