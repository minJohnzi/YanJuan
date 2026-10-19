import { validateSubjectiveEvaluationSchema } from '../shared/schemaValidator.ts';
import type {
  ObjectiveAIAnalysis,
  SubjectiveEvaluationResult,
} from '../shared/types.ts';
import type { ModelProvider } from './modelProviders.ts';
import { SecurityError } from './securityAndCrypto.ts';

export interface EvaluateSubjectiveInput {
  taskType: 'translation' | 'practical-writing' | 'visual-writing';
  taskId: string;
  answerVersionId: string;
  evaluationMode: 'deep-two-stage' | 'fast-single-stage';
  usedHints: boolean;
  questionPrompt: string;
  userAnswer: string;
  requiredFacts?: string[];
  hasVisualMaterial?: boolean;
}

export interface Stage2ReviewOutput {
  approved: boolean;
  adjustedScore: number;
  adjustedConfidence: 'high' | 'medium' | 'low';
  verifiedFactCoverage: boolean;
  notes: string[];
}

export const PROMPT_VERSION = 'yanjuan-eval-v1.2';

/**
 * Executes Two-Stage Subjective AI Grading (or Fast Single-Stage when requested).
 * - Enforces vision capability check if taskType === 'visual-writing' and hasVisualMaterial is true.
 * - Verifies all annotation quotes against userAnswer via validateSubjectiveEvaluationSchema.
 * - If Stage 2 fails, retains Stage 1 intact with reviewerDecision = 'provisional-stage2-failed'.
 */
export async function runTwoStageSubjectiveEvaluation(
  provider: ModelProvider,
  input: EvaluateSubjectiveInput,
  stage2Provider: ModelProvider = provider
): Promise<SubjectiveEvaluationResult> {
  if (!input.userAnswer || input.userAnswer.trim().length === 0) {
    throw new SecurityError('EMPTY_USER_ANSWER', '用户作答内容不能为空', 400);
  }

  // Vision check for visual-writing
  if (
    input.taskType === 'visual-writing' &&
    input.hasVisualMaterial &&
    !provider.getCapabilities().supportsVision
  ) {
    throw new SecurityError(
      'PROVIDER_VISION_UNSUPPORTED',
      `当前模型 (${provider.modelName}) 不支持图片视觉理解，无法批改图画/图表大作文。请切换至支持视觉的模型（如 Gemini）。`,
      422
    );
  }

  const maxScore = input.taskType === 'visual-writing' ? 20 : 10;

  const stage1System = `你是考研英语一资深阅卷分析专家（阶段一：分析者）。
请严格根据题目要求、评分标准与用户作答版本进行客观、克制、有据可查的批改。
严禁把推测性原因写成确定事实；所有原文批注 (annotations) 的 quotedUserText 必须逐字精确摘自用户答案原文，不得改动一字。
参考译文或示例范文必须标记为 AI 生成（referenceContentSource: "ai-generated"）。`;

  const stage1Prompt = `任务类型: ${input.taskType} (满分 ${maxScore} 分)
题目与要求:
${input.questionPrompt}
${
  input.requiredFacts && input.requiredFacts.length > 0
    ? `\n必须覆盖的图画/材料事实:\n- ${input.requiredFacts.join('\n- ')}`
    : ''
}

用户答案原文 (请严格在此文本内匹配 quotedUserText):
"""
${input.userAnswer}
"""

请返回包含以下字段的 JSON 对象:
{
  "centralScore": 数字 (0 到 ${maxScore}),
  "scoreRangeMin": 数字,
  "scoreRangeMax": 数字,
  "confidence": "high" | "medium" | "low",
  "dimensionScores": [{ "dimensionId": "字符串", "name": "分项名称", "score": 数字, "maxScore": 数字, "rationale": "评分依据" }],
  "strengths": ["优点1", "优点2"],
  "issues": [{ "category": "问题分类", "description": "具体说明", "evidence": "原文证据", "deductionRationale": "失分依据" }],
  "annotations": [{ "issueType": "grammar"|"vocabulary"|"coherence"|"completeness"|"register"|"translation-accuracy"|"chart-fact", "quotedUserText": "必须完全存在于用户答案中的原词句", "startOffset": 数字, "endOffset": 数字, "explanation": "原因说明", "suggestion": "修改建议", "severity": "high"|"medium"|"low" }],
  "revisionTasks": [{ "id": "task-1", "priority": 1, "instruction": "具体修改任务 (共3-5项)" }],
  "transferableLessons": ["可迁移结论1", "可迁移结论2"],
  "referenceContent": "AI参考译文或AI生成示例全文",
  "referenceContentSource": "ai-generated"
}`;

  const stage1Validated = await provider.generateStructured<SubjectiveEvaluationResult>({
    systemInstruction: stage1System,
    prompt: stage1Prompt,
    maxRetries: 2,
    validateFn: (raw) =>
      validateSubjectiveEvaluationSchema(raw, input.userAnswer, maxScore),
  });

  const nowIso = new Date().toISOString();
  const baseResult: SubjectiveEvaluationResult = {
    id: `eval-${input.answerVersionId}-${Date.now()}`,
    taskType: input.taskType,
    taskId: input.taskId,
    answerVersionId: input.answerVersionId,
    evaluationMode: input.evaluationMode,
    usedHints: input.usedHints,
    centralScore: stage1Validated.centralScore,
    scoreRangeMin: stage1Validated.scoreRangeMin,
    scoreRangeMax: stage1Validated.scoreRangeMax,
    maxScore,
    confidence: stage1Validated.confidence,
    dimensionScores: stage1Validated.dimensionScores,
    strengths: stage1Validated.strengths,
    issues: stage1Validated.issues,
    annotations: stage1Validated.annotations,
    revisionTasks: stage1Validated.revisionTasks.slice(0, 5),
    transferableLessons: stage1Validated.transferableLessons,
    referenceContent: stage1Validated.referenceContent,
    referenceContentSource: 'ai-generated',
    reviewerDecision:
      input.evaluationMode === 'fast-single-stage'
        ? 'skipped-fast-mode'
        : 'provisional-stage2-failed',
    reviewerAdjustments: {
      stage1Score: stage1Validated.centralScore,
      finalScore: stage1Validated.centralScore,
      scoreDelta: 0,
      stabilityWarning: false,
      notes:
        input.evaluationMode === 'fast-single-stage'
          ? ['快速批改模式仅执行第一阶段分析']
          : [],
      verifiedFactCoverage: true,
    },
    modelProvider: provider.providerId,
    modelName: provider.modelName,
    promptVersion: PROMPT_VERSION,
    createdAt: nowIso,
  };

  if (input.evaluationMode === 'fast-single-stage') {
    return baseResult;
  }

  // Stage 2: Reviewer
  try {
    return await runStage2ReviewOnly(
      stage2Provider,
      baseResult,
      input.questionPrompt,
      input.userAnswer,
      input.requiredFacts
    );
  } catch {
    // Stage 2 failed -> retain Stage 1 result as provisional-stage2-failed!
    return {
      ...baseResult,
      reviewerDecision: 'provisional-stage2-failed',
      reviewerAdjustments: {
        ...baseResult.reviewerAdjustments,
        notes: [
          '第二阶段复核请求未完成，已完整保留第一阶段分析结果（待复核），可点击“重新复核”单独执行阶段二。',
        ],
      },
    };
  }
}

/**
 * Executes ONLY Stage 2 (Reviewer) on an existing Stage 1 evaluation without re-running Stage 1.
 */
export async function runStage2ReviewOnly(
  reviewerProvider: ModelProvider,
  stage1Evaluation: SubjectiveEvaluationResult,
  questionPrompt: string,
  userAnswer: string,
  requiredFacts?: string[]
): Promise<SubjectiveEvaluationResult> {
  const maxScore = stage1Evaluation.maxScore;
  const reviewerSystem = `你是考研英语一阅卷复核组长（阶段二：复核者）。
请审核第一阶段分析者的批改结果：
1. 是否遗漏关键问题或误判用户的合理英文/中文表达；
2. 分数与问题反馈是否一致；
3. 图画/材料事实是否准确；
4. 给出复核后的最终参考分 (adjustedScore)。`;

  const reviewerPrompt = `题目要求:
${questionPrompt}
${
  requiredFacts && requiredFacts.length > 0
    ? `必写事实: ${requiredFacts.join('；')}`
    : ''
}

用户答案原文:
"""
${userAnswer}
"""

阶段一初步评分: ${stage1Evaluation.centralScore} / ${maxScore}
阶段一反馈摘要: ${JSON.stringify({
    dimensionScores: stage1Evaluation.dimensionScores,
    issues: stage1Evaluation.issues,
  })}

请输出 JSON:
{
  "approved": 布尔值 (若无需调整分数则为 true，需调整则为 false),
  "adjustedScore": 数字 (0 到 ${maxScore}),
  "adjustedConfidence": "high" | "medium" | "low",
  "verifiedFactCoverage": 布尔值,
  "notes": ["复核结论1", "复核结论2"]
}`;

  const reviewOut = await reviewerProvider.generateStructured<Stage2ReviewOutput>({
    systemInstruction: reviewerSystem,
    prompt: reviewerPrompt,
    maxRetries: 1,
    validateFn: (raw) => {
      if (!raw || typeof raw !== 'object') {
        return { valid: false, errors: ['复核输出不是对象'] };
      }
      const r = raw as Record<string, unknown>;
      if (
        typeof r.adjustedScore !== 'number' ||
        r.adjustedScore < 0 ||
        r.adjustedScore > maxScore
      ) {
        return { valid: false, errors: ['adjustedScore 超出范围'] };
      }
      if (!Array.isArray(r.notes)) {
        return { valid: false, errors: ['notes 必须为数组'] };
      }
      return { valid: true, errors: [], value: r as unknown as Stage2ReviewOutput };
    },
  });

  const stage1Score = stage1Evaluation.reviewerAdjustments.stage1Score;
  const finalScore = Math.round(reviewOut.adjustedScore * 2) / 2;
  const scoreDelta = Math.round((finalScore - stage1Score) * 10) / 10;
  const stabilityThreshold = maxScore === 20 ? 3.5 : 2.0;
  const stabilityWarning = Math.abs(scoreDelta) >= stabilityThreshold;

  return {
    ...stage1Evaluation,
    centralScore: finalScore,
    confidence: stabilityWarning ? 'low' : reviewOut.adjustedConfidence || stage1Evaluation.confidence,
    reviewerDecision: Math.abs(scoreDelta) > 0 ? 'adjusted' : 'approved',
    reviewerAdjustments: {
      stage1Score,
      finalScore,
      scoreDelta,
      stabilityWarning,
      notes: stabilityWarning
        ? [
            ...reviewOut.notes,
            '本次评分稳定性较低，建议重新分析。',
          ]
        : reviewOut.notes,
      verifiedFactCoverage: Boolean(reviewOut.verifiedFactCoverage),
    },
  };
}

/**
 * Generates asynchronous AI analysis for an objective question.
 * Strictly marks inferred error causes as `possibleErrorCauses` ("可能错因").
 */
export async function runObjectiveQuestionAnalysis(
  provider: ModelProvider,
  input: {
    questionNumber: number;
    passageText: string;
    questionPrompt: string;
    options: { key: string; text: string }[];
    correctAnswer: string;
    userSelectedAnswer: string;
  }
): Promise<ObjectiveAIAnalysis> {
  const systemInstruction = `你是考研英语一客观题精读解析导师。
请基于原文定位证据句，分析正确选项同义替换与干扰项设错方式。
严禁把推测性错因写成确定事实，所有错因分析必须以“可能错因”表述。`;

  const prompt = `题号: ${input.questionNumber}
题干: ${input.questionPrompt}
选项:
${input.options.map((o) => `[${o.key}] ${o.text}`).join('\n')}
官方正确答案: ${input.correctAnswer}
用户所选答案: ${input.userSelectedAnswer || '未作答'}

原文材料片段:
"""
${input.passageText.slice(0, 3500)}
"""

请返回 JSON:
{
  "evidenceQuote": "原文定位证据句英文原句及简明释义",
  "questionCategory": "题型分类（如：细节事实题 / 词义指代题 / 推理判断题 / 主旨大意题 / 作者态度题）",
  "optionBreakdown": {
    "A": "A项分析",
    "B": "B项分析",
    "C": "C项分析",
    "D": "D项分析"
  },
  "possibleErrorCauses": ["可能错因1（必须使用推测性措辞，不得断言）", "可能错因2"],
  "transferableConclusion": "可迁移解题方法结论"
}`;

  const out = await provider.generateStructured<Omit<ObjectiveAIAnalysis, 'questionNumber' | 'modelProvider' | 'modelName' | 'createdAt'>>({
    systemInstruction,
    prompt,
    maxRetries: 1,
    validateFn: (raw) => {
      if (!raw || typeof raw !== 'object') {
        return { valid: false, errors: ['输出不是JSON对象'] };
      }
      const r = raw as Record<string, unknown>;
      if (typeof r.evidenceQuote !== 'string' || !Array.isArray(r.possibleErrorCauses)) {
        return { valid: false, errors: ['缺少 evidenceQuote 或 possibleErrorCauses'] };
      }
      return { valid: true, errors: [], value: r as any };
    },
  });

  return {
    questionNumber: input.questionNumber,
    evidenceQuote: out.evidenceQuote,
    questionCategory: out.questionCategory || '阅读理解',
    optionBreakdown: out.optionBreakdown || {},
    possibleErrorCauses: out.possibleErrorCauses.map((c) =>
      c.startsWith('可能') ? c : `可能原因：${c}`
    ),
    transferableConclusion: out.transferableConclusion || '',
    modelProvider: provider.providerId,
    modelName: provider.modelName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Handles follow-up Q&A on a specific question.
 * Carries ONLY the current question, user answer, and existing analysis — never unrelated user data.
 */
export async function runFollowUpAnalysis(
  provider: ModelProvider,
  input: {
    questionNumber: number;
    questionContext: string;
    userAnswer: string;
    existingAnalysisSummary: string;
    userQuestion: string;
  }
): Promise<{ reply: string; modelProvider: string; modelName: string; createdAt: string }> {
  const systemInstruction = `你是考研英语一真题答疑导师。仅基于当前题目、用户当前作答及已有解析回答追问。
保持条理清晰、克制严谨；对错因的探讨使用“可能”等非武断表述。`;

  const prompt = `[当前题号] 第 ${input.questionNumber} 题
[题目上下文] ${input.questionContext.slice(0, 2000)}
[用户当前答案] ${input.userAnswer.slice(0, 1000)}
[已有解析摘要] ${input.existingAnalysisSummary.slice(0, 1500)}
[用户追问] ${input.userQuestion.slice(0, 500)}`;

  const reply = await provider.generateText({
    systemInstruction,
    prompt,
    temperature: 0.3,
  });

  return {
    reply,
    modelProvider: provider.providerId,
    modelName: provider.modelName,
    createdAt: new Date().toISOString(),
  };
}
