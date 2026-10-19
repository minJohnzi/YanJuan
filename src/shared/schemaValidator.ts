import type {
  EvaluationAnnotation,
  Exam,
  SubjectiveEvaluationResult,
} from './types.ts';

/**
 * Verifies that every annotation's quotedUserText and [startOffset, endOffset]
 * accurately match the user's immutable answer text.
 * If offset is slightly drifted by whitespace, repairs exact offset only if
 * quotedUserText appears verbatim in userText; if quotedUserText does not exist
 * in userText, rejects the annotation payload immediately.
 */
export function verifyAndNormalizeAnnotations(
  userText: string,
  annotations: EvaluationAnnotation[]
): { valid: boolean; normalized: EvaluationAnnotation[]; invalidQuotes: string[] } {
  const normalized: EvaluationAnnotation[] = [];
  const invalidQuotes: string[] = [];

  for (const ann of annotations) {
    if (!ann || typeof ann.quotedUserText !== 'string' || ann.quotedUserText.trim().length === 0) {
      invalidQuotes.push(String(ann?.quotedUserText ?? '<empty>'));
      continue;
    }

    const sliceMatches =
      typeof ann.startOffset === 'number' &&
      typeof ann.endOffset === 'number' &&
      ann.startOffset >= 0 &&
      ann.endOffset <= userText.length &&
      ann.startOffset < ann.endOffset &&
      userText.slice(ann.startOffset, ann.endOffset) === ann.quotedUserText;

    if (sliceMatches) {
      normalized.push(ann);
      continue;
    }

    // Check if the exact substring exists in userText
    const foundIdx = userText.indexOf(ann.quotedUserText);
    if (foundIdx === -1) {
      invalidQuotes.push(ann.quotedUserText);
    } else {
      normalized.push({
        ...ann,
        startOffset: foundIdx,
        endOffset: foundIdx + ann.quotedUserText.length,
      });
    }
  }

  return {
    valid: invalidQuotes.length === 0,
    normalized,
    invalidQuotes,
  };
}

/**
 * Runtime schema validator for SubjectiveEvaluationResult returned by AI providers.
 */
export function validateSubjectiveEvaluationSchema(
  raw: unknown,
  expectedUserText: string,
  expectedMaxScore: number
): { valid: boolean; errors: string[]; value?: SubjectiveEvaluationResult } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['AI输出不是有效的JSON对象'] };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.centralScore !== 'number' || Number.isNaN(obj.centralScore)) {
    errors.push('centralScore 必须为数字');
  } else if (obj.centralScore < 0 || obj.centralScore > expectedMaxScore) {
    errors.push(`centralScore (${obj.centralScore}) 超出允许范围 0–${expectedMaxScore}`);
  }

  if (typeof obj.scoreRangeMin !== 'number' || typeof obj.scoreRangeMax !== 'number') {
    errors.push('scoreRangeMin 与 scoreRangeMax 必须为数字');
  } else if (obj.scoreRangeMin > obj.scoreRangeMax) {
    errors.push('scoreRangeMin 不能大于 scoreRangeMax');
  }

  if (!['high', 'medium', 'low'].includes(String(obj.confidence))) {
    errors.push('confidence 必须为 high | medium | low');
  }

  if (!Array.isArray(obj.dimensionScores) || obj.dimensionScores.length === 0) {
    errors.push('dimensionScores 必须为非空数组');
  }

  if (!Array.isArray(obj.strengths)) {
    errors.push('strengths 必须为数组');
  }

  if (!Array.isArray(obj.issues)) {
    errors.push('issues 必须为数组');
  }

  if (!Array.isArray(obj.revisionTasks) || obj.revisionTasks.length < 1) {
    errors.push('revisionTasks 必须包含修改任务');
  }

  if (!Array.isArray(obj.transferableLessons)) {
    errors.push('transferableLessons 必须为数组');
  }

  if (typeof obj.referenceContent !== 'string' || obj.referenceContent.trim().length === 0) {
    errors.push('referenceContent 必须为非空字符串');
  }

  if (!Array.isArray(obj.annotations)) {
    errors.push('annotations 必须为数组');
  } else {
    const quoteCheck = verifyAndNormalizeAnnotations(
      expectedUserText,
      obj.annotations as EvaluationAnnotation[]
    );
    if (!quoteCheck.valid) {
      errors.push(
        `批注引用校验失败，以下引用不存在于用户原文中: ${quoteCheck.invalidQuotes.join(' | ')}`
      );
    } else {
      obj.annotations = quoteCheck.normalized;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    value: obj as unknown as SubjectiveEvaluationResult,
  };
}

/**
 * Runtime structural validator for Exam JSON schema.
 */
export function validateExamSchemaStructure(exam: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!exam || typeof exam !== 'object') {
    return { valid: false, errors: ['Exam 必须为对象'] };
  }
  const e = exam as Partial<Exam>;
  if (typeof e.id !== 'string' || !e.id) errors.push('缺少 exam.id');
  if (typeof e.year !== 'number' || e.year < 2010 || e.year > 2026) {
    errors.push('exam.year 必须在 2010–2026 之间');
  }
  if (e.subject !== '考研英语一') {
    errors.push('exam.subject 必须为 考研英语一');
  }
  if (typeof e.dataVersion !== 'string' || !e.dataVersion) {
    errors.push('缺少 exam.dataVersion');
  }
  if (!Array.isArray(e.sections) || e.sections.length === 0) {
    errors.push('exam.sections 必须为非空数组');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Computes word-level and line-level diff between two subjective answer versions.
 */
export interface DiffSegment {
  type: 'equal' | 'added' | 'removed' | 'modified';
  text: string;
  previousText?: string;
}

export function computeVersionDiff(oldText: string, newText: string): {
  segments: DiffSegment[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
} {
  const oldTokens = oldText.trim().split(/(\s+)/).filter(Boolean);
  const newTokens = newText.trim().split(/(\s+)/).filter(Boolean);

  // LCS matrix for token diff
  const m = oldTokens.length;
  const n = newTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawOps: { type: 'equal' | 'added' | 'removed'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldTokens[i] === newTokens[j]) {
      rawOps.push({ type: 'equal', text: oldTokens[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawOps.push({ type: 'removed', text: oldTokens[i] });
      i++;
    } else {
      rawOps.push({ type: 'added', text: newTokens[j] });
      j++;
    }
  }
  while (i < m) {
    rawOps.push({ type: 'removed', text: oldTokens[i++] });
  }
  while (j < n) {
    rawOps.push({ type: 'added', text: newTokens[j++] });
  }

  // Merge adjacent ops & pair removed+added as 'modified'
  const merged: DiffSegment[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;

  for (const op of rawOps) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.text += op.text;
    } else if (last && last.type === 'removed' && op.type === 'added' && op.text.trim()) {
      last.type = 'modified';
      last.previousText = last.text;
      last.text = op.text;
      removedCount = Math.max(0, removedCount - 1);
      modifiedCount++;
    } else {
      merged.push({ ...op });
      if (op.type === 'added' && op.text.trim()) addedCount++;
      if (op.type === 'removed' && op.text.trim()) removedCount++;
    }
  }

  return { segments: merged, addedCount, removedCount, modifiedCount };
}
