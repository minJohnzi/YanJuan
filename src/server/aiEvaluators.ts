import crypto from 'node:crypto';
import {
  computeVersionScoreDelta,
  stripUnreleasedAnswerFields,
  validateSubjectiveEvaluationSchema,
} from '../shared/schemaValidator.ts';
import type {
  AITaskType,
  DataQualityConflictInfo,
  EvaluationRun,
  ExamItem,
  ExamUnit,
  FollowUpTurn,
  ItemRubric,
  ObjectiveAIAnalysis,
  ProviderType,
  RevisionVerificationItem,
  SubjectiveEvaluationResult,
  TokenUsageSummary,
  WritingScaffoldResult,
} from '../shared/types.ts';
import type { ModelProvider, MultimodalImageInput } from './modelProviders.ts';
import { SecurityError } from './securityAndCrypto.ts';

export const PROMPT_VERSION = 'yanjuan-eval-v2.0';

export interface SubjectiveEvaluationInput {
  taskType: 'translation' | 'practical-writing' | 'visual-writing';
  taskId: string;
  answerVersionId: string;
  previousAnswerVersionId?: string | null;
  previousVersionLabel?: string;
  previousUserAnswer?: string;
  previousEvaluation?: SubjectiveEvaluationResult | null;
  evaluationMode: 'deep-two-stage' | 'fast-single-stage';
  usedHints: boolean;
  questionPrompt: string;
  userAnswer: string;
  maxScore?: number;
  rubric?: ItemRubric;
  requiredFacts?: string[];
  hasVisualMaterial?: boolean;
  images?: MultimodalImageInput[];
  imageAssetsUsed?: string[];
  allowTextFallbackForVision?: boolean;
  referenceText?: string | null;
  signal?: AbortSignal;
}

function getDefaultMaxScore(taskType: SubjectiveEvaluationInput['taskType']): number {
  if (taskType === 'practical-writing') return 10;
  if (taskType === 'visual-writing') return 20;
  return 10;
}

function getDefaultRubric(
  taskType: SubjectiveEvaluationInput['taskType'],
  maxScore: number
): ItemRubric {
  if (taskType === 'translation') {
    return {
      maxScore,
      dimensions: [
        {
          id: 'dim-accuracy',
          name: '核心语义与采分点准确度',
          maxScore: Math.round(maxScore * 0.4 * 10) / 10,
          description: '核心实词、指代关系、否定与因果准确还原，无漏译或曲解。',
        },
        {
          id: 'dim-syntax',
          name: '长难句结构切分与从句逻辑',
          maxScore: Math.round(maxScore * 0.35 * 10) / 10,
          description: '定语从句、状语从句、非谓语及被动结构层次清晰。',
        },
        {
          id: 'dim-fluency',
          name: '中文表达通顺度与学术语域',
          maxScore: Math.round(maxScore * 0.25 * 10) / 10,
          description: '符合现代汉语书面规范，无生硬欧化语序。',
        },
      ],
    };
  }
  if (taskType === 'practical-writing') {
    return {
      maxScore,
      dimensions: [
        {
          id: 'dim-content',
          name: '内容要点完整性',
          maxScore: 4,
          description: '完整覆盖题目要求的全部信函/通知交际要点，次重点详略得当。',
        },
        {
          id: 'dim-format-register',
          name: '格式规范与语域得体度',
          maxScore: 3,
          description: '称呼、落款、礼貌用语及正式/半正式语体恰当。',
        },
        {
          id: 'dim-language',
          name: '语法准确性与衔接连贯',
          maxScore: 3,
          description: '句式多样，拼写与语法准确，段落衔接自然。',
        },
      ],
    };
  }
  return {
    maxScore,
    dimensions: [
      {
        id: 'dim-visual-theme',
        name: '图画描述与核心寓意切题度',
        maxScore: 7,
        description: '准确描述图画表面细节与对比关系，深刻提炼象征寓意，立意切题。',
      },
      {
        id: 'dim-structure-logic',
        name: '三段式论证层次与逻辑推进',
        maxScore: 6,
        description: '第一段描图、第二段析因/论证、第三段总结建议，衔接严密。',
      },
      {
        id: 'dim-lexical-syntax',
        name: '学术词汇多样性与复杂句式',
        maxScore: 7,
        description: '从句、非谓语、强调及高级学术词汇运用准确自然。',
      },
    ],
  };
}

const STAGE1_SCHEMA_DESCRIPTION = `{
  "centralScore": number,
  "scoreRangeMin": number,
  "scoreRangeMax": number,
  "confidence": "high | medium | low",
  "dimensionScores": [
    {
      "dimensionId": "string",
      "name": "string",
      "score": number,
      "maxScore": number,
      "rationale": "string"
    }
  ],
  "strengths": ["string"],
  "issues": [
    {
      "category": "string",
      "description": "string",
      "evidence": "string",
      "deductionRationale": "string"
    }
  ],
  "annotations": [
    {
      "id": "string",
      "issueType": "grammar | vocabulary | coherence | completeness | register | translation-accuracy | chart-fact",
      "quotedUserText": "string (必须逐字精确摘自考生原文，不能改动任何字符)",
      "startOffset": number,
      "endOffset": number,
      "explanation": "string (包含问题诊断与扣分原因)",
      "suggestion": "string (提供原句最小修正 MinimalFix 与高分升级表达 UpgradedVersion)",
      "severity": "high | medium | low"
    }
  ],
  "revisionTasks": [
    {
      "id": "string",
      "priority": 1,
      "instruction": "string (具体可执行的下一版修改任务)",
      "targetText": "string"
    }
  ],
  "revisionVerification": [
    {
      "revisionTaskId": "string",
      "instruction": "string",
      "status": "resolved | partially-resolved | unaddressed | regressed",
      "evidence": "string",
      "explanation": "string"
    }
  ],
  "transferableLessons": ["string"],
  "referenceContent": "string",
  "referenceContentSource": "ai-generated | source-provided"
}`;

const STAGE2_SCHEMA_DESCRIPTION = `{
  "finalScore": number,
  "verifiedFactCoverage": boolean,
  "notes": ["string"],
  "dimensionAdjustments": [
    {
      "dimensionId": "string",
      "stage1Score": number,
      "finalScore": number,
      "reason": "string"
    }
  ]
}`;

interface Stage2ReviewPayload {
  finalScore: number;
  verifiedFactCoverage: boolean;
  notes: string[];
  dimensionAdjustments?: {
    dimensionId: string;
    stage1Score: number;
    finalScore: number;
    reason: string;
  }[];
}

export function reconcileDimensionScores(
  dimensions: SubjectiveEvaluationResult['dimensionScores'],
  targetTotalScore: number,
  maxScore: number,
  adjustments?: Stage2ReviewPayload['dimensionAdjustments']
): SubjectiveEvaluationResult['dimensionScores'] {
  if (!dimensions || dimensions.length === 0) return [];
  const nextDims = dimensions.map((d) => {
    const adj = adjustments?.find((a) => a.dimensionId === d.dimensionId);
    if (adj && typeof adj.finalScore === 'number' && !Number.isNaN(adj.finalScore)) {
      return {
        ...d,
        score: Math.max(0, Math.min(d.maxScore, Math.round(adj.finalScore * 10) / 10)),
        rationale: adj.reason ? `${d.rationale}（复核校准：${adj.reason}）` : d.rationale,
      };
    }
    return { ...d };
  });

  const sumMax = nextDims.reduce((acc, d) => acc + d.maxScore, 0);
  if (Math.abs(sumMax - maxScore) <= 0.5) {
    const currentSum = nextDims.reduce((acc, d) => acc + d.score, 0);
    let diff = Math.round((targetTotalScore - currentSum) * 10) / 10;
    for (let i = 0; i < nextDims.length && Math.abs(diff) > 0.05; i++) {
      const d = nextDims[i];
      const room = diff > 0 ? d.maxScore - d.score : -d.score;
      const step = diff > 0 ? Math.min(diff, room) : Math.max(diff, room);
      d.score = Math.round((d.score + step) * 10) / 10;
      diff = Math.round((diff - step) * 10) / 10;
    }
  }
  return nextDims;
}

/**
 * Runs the Two-Stage Subjective Evaluation Pipeline:
 * - Stage 1: Full Rubric injection, Multimodal Vision or explicit text-fallback, verbatim quote verification, V2/V3 revision verification
 * - Stage 2: Independent reviewer verification, dimension score reconciliation, and graceful fallback to `provisional-stage2-failed`
 */
export async function runTwoStageSubjectiveEvaluation(
  stage1Provider: ModelProvider,
  input: SubjectiveEvaluationInput,
  stage2Provider?: ModelProvider
): Promise<SubjectiveEvaluationResult> {
  const startMs = Date.now();
  const maxScore = input.maxScore ?? getDefaultMaxScore(input.taskType);
  const rubric = input.rubric ?? getDefaultRubric(input.taskType, maxScore);

  const stage1Caps = stage1Provider.getCapabilities();
  let usedVision = false;
  let visionDegradedToText = false;
  let imagesToPass: MultimodalImageInput[] | undefined;

  if (input.taskType === 'visual-writing' || input.hasVisualMaterial) {
    const hasImages = Boolean(input.images && input.images.length > 0);
    if (hasImages && stage1Caps.supportsVision) {
      usedVision = true;
      imagesToPass = input.images;
    } else if (input.allowTextFallbackForVision === false) {
      throw new SecurityError(
        'VISION_NOT_SUPPORTED',
        `当前模型 (${stage1Provider.modelName}) 未验证多模态看图能力，且任务策略禁止降级为文字描述模式。请切换支持 Vision 的模型或开启文字事实降级。`,
        422
      );
    } else {
      visionDegradedToText = true;
    }
  }

  const rubricBlock = rubric.dimensions
    .map(
      (d, idx) =>
        `${idx + 1}. [${d.id}] ${d.name} (满分 ${d.maxScore} 分): ${d.description}`
    )
    .join('\n');

  const revisionPromptBlock =
    input.previousEvaluation && input.previousUserAnswer
      ? `\n【历史版本增量对比 (${input.previousVersionLabel || '上一版'} -> 当前版本)】
上一版得分：${input.previousEvaluation.centralScore} / ${input.previousEvaluation.maxScore}
上一版学生原文：
"""
${input.previousUserAnswer}
"""
上一版待办修改任务 (revisionTasks)：
${input.previousEvaluation.revisionTasks
  .map((t) => `- [${t.id}] (优先级 ${t.priority}): ${t.instruction}`)
  .join('\n')}
请在输出中提供 revisionVerification 数组，逐项核对上述修改任务在本版中是否已解决 (resolved / partially-resolved / unaddressed / regressed)，并引用本版文本证据说明！\n`
      : '';

  const stage1Prompt = `你是全国硕士研究生入学统一考试英语（一）主观题阅卷专家。
请对以下考生作答进行第一阶段精细化批改。
【题型】${input.taskType}（满分 ${maxScore} 分）
【模式】${usedVision ? '多模态真实看图批改（已附真题插图）' : visionDegradedToText ? '图画文字要素降级模式（未传原图，依据 requiredFacts 判分）' : '标准文本批改'}
【题目指令】
${input.questionPrompt}
${
  input.requiredFacts && input.requiredFacts.length > 0
    ? `【必含图画/内容要素】\n${input.requiredFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n`
    : ''
}
${input.referenceText ? `【来源参考译文/范文】\n${input.referenceText}\n` : ''}
【分项评分标准 (Rubric)】
${rubricBlock}
${revisionPromptBlock}
【严格批注约束】
1. annotations 中的 quotedUserText 必须逐字精确摘自下方【考生作答原文】，一字不差！
2. dimensionScores 各项分数之和应当与 centralScore 保持一致。

【考生作答原文】
"""
${input.userAnswer}
"""`;

  let stage1Raw: SubjectiveEvaluationResult;
  let stage1Usage: TokenUsageSummary | undefined;
  let stage1RetryCount = 0;

  if (stage1Provider.generateStructuredWithTelemetry) {
    const gen1 = await stage1Provider.generateStructuredWithTelemetry(
      stage1Prompt,
      STAGE1_SCHEMA_DESCRIPTION,
      (raw) => validateSubjectiveEvaluationSchema(raw, input.userAnswer, maxScore),
      {
        images: imagesToPass,
        signal: input.signal,
        maxRetries: 2,
      }
    );
    stage1Raw = gen1.value;
    stage1Usage = gen1.telemetry.usage;
    stage1RetryCount = gen1.telemetry.retryCount;
  } else {
    stage1Raw = await stage1Provider.generateStructured(
      stage1Prompt,
      STAGE1_SCHEMA_DESCRIPTION,
      (raw) => validateSubjectiveEvaluationSchema(raw, input.userAnswer, maxScore),
      {
        images: imagesToPass,
        signal: input.signal,
        maxRetries: 2,
      }
    );
  }

  const stage1Score = stage1Raw.centralScore;
  let finalScore = stage1Score;
  let finalDimensionScores = reconcileDimensionScores(
    stage1Raw.dimensionScores,
    stage1Score,
    maxScore
  );
  let reviewerDecision: SubjectiveEvaluationResult['reviewerDecision'] =
    input.evaluationMode === 'fast-single-stage' ? 'skipped-fast-mode' : 'approved';
  let reviewerNotes: string[] = [];
  let verifiedFactCoverage = true;
  let dimensionAdjustments: SubjectiveEvaluationResult['reviewerAdjustments']['dimensionAdjustments'];

  if (visionDegradedToText) {
    reviewerNotes.push(
      '提示：本次看图写作采用「文字事实要素降级模式」批改，模型未直接读取图画像素。'
    );
  }

  // Run Stage 2 independent review if in deep-two-stage mode and a stage2Provider is supplied
  const effectiveStage2 = stage2Provider || stage1Provider;
  const shouldRunStage2 =
    input.evaluationMode === 'deep-two-stage' && Boolean(stage2Provider);

  if (shouldRunStage2 && effectiveStage2) {
    const stage2Prompt = `你是考研英语（一）阅卷组长（第二阶段独立复核员）。
请审查第一阶段初评结果是否存在总分与分项得分矛盾、必含要点漏判或给分失衡问题。
【题型】${input.taskType}（满分 ${maxScore} 分）
【评分标准】
${rubricBlock}
${
  input.requiredFacts && input.requiredFacts.length > 0
    ? `【必含要素】${input.requiredFacts.join('；')}\n`
    : ''
}
【考生原文】
"""
${input.userAnswer}
"""
【第一阶段初评结果】
- 初评总分：${stage1Score} / ${maxScore}
- 初评维度得分：${JSON.stringify(stage1Raw.dimensionScores)}
- 初评扣分点：${JSON.stringify(stage1Raw.issues)}
- 初评批注数：${stage1Raw.annotations.length}

请输出复核后的 finalScore、verifiedFactCoverage、notes 与 dimensionAdjustments。`;

    try {
      const stage2Data = await effectiveStage2.generateStructured<Stage2ReviewPayload>(
        stage2Prompt,
        STAGE2_SCHEMA_DESCRIPTION,
        (raw) => {
          if (!raw || typeof raw !== 'object') {
            return { valid: false, errors: ['Stage 2 output must be an object'] };
          }
          const obj = raw as Record<string, unknown>;
          if (
            typeof obj.finalScore !== 'number' ||
            Number.isNaN(obj.finalScore) ||
            obj.finalScore < 0 ||
            obj.finalScore > maxScore
          ) {
            return {
              valid: false,
              errors: [`finalScore must be between 0 and ${maxScore}`],
            };
          }
          return {
            valid: true,
            errors: [],
            value: {
              finalScore: Math.round(obj.finalScore * 10) / 10,
              verifiedFactCoverage: Boolean(obj.verifiedFactCoverage ?? true),
              notes: Array.isArray(obj.notes) ? obj.notes.map(String) : [],
              dimensionAdjustments: Array.isArray(obj.dimensionAdjustments)
                ? (obj.dimensionAdjustments as Stage2ReviewPayload['dimensionAdjustments'])
                : undefined,
            },
          };
        },
        { maxRetries: 1, signal: input.signal }
      );

      finalScore = stage2Data.finalScore;
      verifiedFactCoverage = stage2Data.verifiedFactCoverage;
      dimensionAdjustments = stage2Data.dimensionAdjustments;
      reviewerNotes = [...reviewerNotes, ...stage2Data.notes];
      reviewerDecision =
        Math.abs(finalScore - stage1Score) >= 0.5 ? 'adjusted' : 'approved';
      finalDimensionScores = reconcileDimensionScores(
        stage1Raw.dimensionScores,
        finalScore,
        maxScore,
        dimensionAdjustments
      );
    } catch (err: any) {
      // Stage 2 failure retains Stage 1 result and marks provisional-stage2-failed
      reviewerDecision = 'provisional-stage2-failed';
      reviewerNotes.push(
        `第二阶段复核超时或异常，已保留第一阶段初评结果 (${String(err?.message || err).slice(0, 80)})`
      );
    }
  }

  // Build revisionVerification & scoreDelta if previousEvaluation was provided
  let revisionVerification: RevisionVerificationItem[] | undefined =
    stage1Raw.revisionVerification;
  if (
    !revisionVerification &&
    input.previousEvaluation &&
    input.previousEvaluation.revisionTasks.length > 0
  ) {
    revisionVerification = input.previousEvaluation.revisionTasks.map((t) => ({
      revisionTaskId: t.id,
      instruction: t.instruction,
      status: finalScore > input.previousEvaluation!.centralScore ? 'resolved' : 'partially-resolved',
      evidence: input.userAnswer.slice(0, 80),
      explanation:
        finalScore > input.previousEvaluation!.centralScore
          ? '新版本整体得分与语言准确度较上一版已落实改进'
          : '建议继续结合本版批注深化打磨该项修改任务',
    }));
  }

  const evalId = `eval-${input.answerVersionId}-${Date.now()}`;
  const scoreRangeMin = Math.max(0, Math.min(finalScore, Math.round((finalScore - 1) * 10) / 10));
  const scoreRangeMax = Math.min(
    maxScore,
    Math.max(finalScore, Math.round((finalScore + 1) * 10) / 10)
  );

  const finalEvaluation: SubjectiveEvaluationResult = {
    id: evalId,
    taskType: input.taskType,
    taskId: input.taskId,
    answerVersionId: input.answerVersionId,
    previousAnswerVersionId: input.previousAnswerVersionId || null,
    evaluationMode: input.evaluationMode,
    usedHints: input.usedHints,
    centralScore: finalScore,
    scoreRangeMin,
    scoreRangeMax,
    maxScore,
    confidence: stage1Raw.confidence || 'high',
    dimensionScores: finalDimensionScores,
    strengths: stage1Raw.strengths || [],
    issues: stage1Raw.issues || [],
    annotations: stage1Raw.annotations || [],
    revisionTasks: (stage1Raw.revisionTasks || []).slice(0, 3),
    revisionVerification,
    transferableLessons: stage1Raw.transferableLessons || [],
    referenceContent:
      input.referenceText || stage1Raw.referenceContent || 'Sample Reference',
    referenceContentSource: input.referenceText
      ? 'source-provided'
      : stage1Raw.referenceContentSource || 'ai-generated',
    reviewerDecision,
    reviewerAdjustments: {
      stage1Score,
      finalScore,
      scoreDelta: Math.round((finalScore - stage1Score) * 10) / 10,
      stabilityWarning: Math.abs(finalScore - stage1Score) >= 3,
      notes: reviewerNotes,
      verifiedFactCoverage,
      dimensionAdjustments,
    },
    modelProvider: stage1Provider.providerId,
    modelName: stage1Provider.modelName,
    stage2ModelProvider: stage2Provider?.providerId,
    stage2ModelName: stage2Provider?.modelName,
    usedVision,
    visionDegradedToText,
    imageAssetsUsed: input.imageAssetsUsed,
    usage: stage1Usage,
    retryCount: stage1RetryCount,
    latencyMs: Date.now() - startMs,
    cacheStatus: 'miss',
    promptVersion: PROMPT_VERSION,
    createdAt: new Date().toISOString(),
  };

  if (input.previousEvaluation && revisionVerification) {
    finalEvaluation.scoreDelta = computeVersionScoreDelta({
      previousVersionId:
        input.previousAnswerVersionId || input.previousEvaluation.answerVersionId,
      previousVersionLabel: input.previousVersionLabel || '上一版',
      previousEvaluation: input.previousEvaluation,
      currentEvaluation: finalEvaluation,
      revisionVerification,
    });
  }

  return finalEvaluation;
}

const OBJECTIVE_ANALYSIS_SCHEMA = `{
  "evidenceQuote": "string (必须直接引用阅读原文中的证据句原文)",
  "questionCategory": "string (如：细节事实题 / 推理判断题 / 词义猜测题 / 主旨大意题 / 逻辑衔接)",
  "optionBreakdown": {
    "A": "string",
    "B": "string",
    "C": "string",
    "D": "string"
  },
  "userChoiceAttraction": "string (分析考生所选选项为何具有迷惑性)",
  "distractorTrapType": "string (干扰项设题手法，如：偷换概念 / 过度推理 / 正反混淆)",
  "selfDiagnosisAssessment": "string (评估考生自评错因是否准确)",
  "possibleErrorCauses": ["string (最多 2 条针对性错因推断)"],
  "nextTimeCheckAction": "string (下次遇到同类题型的 1 步核查动作)",
  "transferableConclusion": "string (可迁移的考研阅读解题方法论总结)"
}`;

export async function runObjectiveItemAnalysis(
  provider: ModelProvider,
  input: {
    questionNumber: number;
    passageText: string;
    questionPrompt: string;
    options: { key: string; text: string }[];
    correctAnswer: string;
    userSelectedAnswer: string;
    userMarkedErrorReasons?: string[];
    dataQuality?: DataQualityConflictInfo;
    signal?: AbortSignal;
  }
): Promise<ObjectiveAIAnalysis> {
  const startMs = Date.now();
  const isDisputed = input.dataQuality?.status === 'disputed';

  const disputeNoticeBlock = isDisputed
    ? `\n【严重数据冲突预警 — 严禁强行圆题】
系统审计发现本题存在「题库原文与答案表语义冲突」(DATA_ANSWER_DISPUTED)：
- 冲突原因：${input.dataQuality?.reason}
- 原文字面支持选项：${input.dataQuality?.semanticCandidateAnswer || 'A'}
- 答案表标注选项：${input.correctAnswer}
请務必在 optionBreakdown 与 transferableConclusion 中明确向考生说明：
1) 根据当前英文段落原句，字面语义直接对应选项 [${input.dataQuality?.semanticCandidateAnswer || 'A'}]；
2) 答案表标注为 [${input.correctAnswer}] 系题库来源与答案表错位所致，绝不能曲解英文原句去强行证明 [${input.correctAnswer}] 正确！\n`
    : '';

  const optionsText = input.options.map((o) => `[${o.key}] ${o.text}`).join('\n');

  const prompt = `你是考研英语（一）客观题精读解析导师。请对第 ${input.questionNumber} 题进行结构化证据定位与干扰项拆解。
【题干】${input.questionPrompt}
【选项】
${optionsText}
【标注答案】${input.correctAnswer}
【考生所选】${input.userSelectedAnswer || '未作答'}
【考生自评错因】${input.userMarkedErrorReasons?.join('、') || '未勾选'}
${disputeNoticeBlock}
【阅读原文】
"""
${input.passageText}
"""`;

  const rawResult = await provider.generateStructured<Omit<ObjectiveAIAnalysis, 'questionNumber' | 'modelProvider' | 'modelName' | 'createdAt'>>(
    prompt,
    OBJECTIVE_ANALYSIS_SCHEMA,
    (raw) => {
      if (!raw || typeof raw !== 'object') {
        return { valid: false, errors: ['Objective analysis must be a JSON object'] };
      }
      const obj = raw as Record<string, unknown>;
      if (typeof obj.evidenceQuote !== 'string' || !obj.evidenceQuote.trim()) {
        return { valid: false, errors: ['evidenceQuote must be a non-empty string'] };
      }
      if (!obj.optionBreakdown || typeof obj.optionBreakdown !== 'object') {
        return { valid: false, errors: ['optionBreakdown must be an object'] };
      }
      return {
        valid: true,
        errors: [],
        value: {
          evidenceQuote: String(obj.evidenceQuote).trim(),
          questionCategory: String(obj.questionCategory || '阅读理解定位分析'),
          optionBreakdown: obj.optionBreakdown as Record<string, string>,
          userChoiceAttraction: obj.userChoiceAttraction
            ? String(obj.userChoiceAttraction)
            : undefined,
          distractorTrapType: obj.distractorTrapType
            ? String(obj.distractorTrapType)
            : undefined,
          selfDiagnosisAssessment: obj.selfDiagnosisAssessment
            ? String(obj.selfDiagnosisAssessment)
            : undefined,
          userMarkedErrorReasons: input.userMarkedErrorReasons,
          possibleErrorCauses: Array.isArray(obj.possibleErrorCauses)
            ? obj.possibleErrorCauses.map(String)
            : [],
          nextTimeCheckAction: obj.nextTimeCheckAction
            ? String(obj.nextTimeCheckAction)
            : undefined,
          transferableConclusion: String(
            obj.transferableConclusion || '定位原文核心句，比对选项同义替换与逻辑方向。'
          ),
          dataQualityWarning: isDisputed ? input.dataQuality?.reason : undefined,
        },
      };
    },
    { maxRetries: 1, signal: input.signal }
  );

  return {
    ...rawResult,
    questionNumber: input.questionNumber,
    modelProvider: provider.providerId,
    modelName: provider.modelName,
    latencyMs: Date.now() - startMs,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Multi-Turn Contextual Follow-Up Analysis with Server Anti-Leakage & Sliding Window
 */
export async function runContextualFollowUpAnalysis(
  provider: ModelProvider,
  input: {
    questionNumber: number;
    questionContext: string;
    userQuestion: string;
    existingAnalysisSummary?: string;
    item?: Partial<ExamItem>;
    unit?: Partial<ExamUnit>;
    userAnswer?: string;
    latestEvaluation?: SubjectiveEvaluationResult | null;
    history?: FollowUpTurn[];
    isSubmittedAuthoritative?: boolean;
    signal?: AbortSignal;
  }
): Promise<{
  answer: string;
  leakedFieldsRemoved: string[];
  modelProvider: ProviderType;
  modelName: string;
  latencyMs: number;
}> {
  const startMs = Date.now();
  const isSubmitted = input.isSubmittedAuthoritative ?? true;

  const sanitized = stripUnreleasedAnswerFields({
    item: input.item,
    unit: input.unit,
    existingAnalysisSummary: input.existingAnalysisSummary,
    isSubmittedAuthoritative: isSubmitted,
  });

  const contextSections: string[] = [
    `【题号与单元背景】第 ${input.questionNumber} 题｜${input.questionContext}`,
  ];

  if (sanitized.safePassageText) {
    contextSections.push(
      `【原文材料】\n${sanitized.safePassageText.slice(0, 2500)}`
    );
  }
  if (sanitized.safeQuestionPrompt) {
    contextSections.push(`【题目要求/题干】\n${sanitized.safeQuestionPrompt}`);
  }
  if (sanitized.safeOptions.length > 0) {
    contextSections.push(
      `【候选项】\n${sanitized.safeOptions.map((o) => `${o.key}. ${o.text}`).join('\n')}`
    );
  }
  if (input.userAnswer) {
    contextSections.push(`【考生当前作答】\n${input.userAnswer.slice(0, 1500)}`);
  }
  if (isSubmitted && sanitized.safeCorrectAnswer) {
    contextSections.push(`【已解锁参考答案】${sanitized.safeCorrectAnswer}`);
  } else if (!isSubmitted) {
    contextSections.push(
      `【防剧透安全约束】当前考生尚未正式交卷！严禁直接透露正确选项字母或代写完整译文/范文，请仅给予解题定位思路与语法结构引导。`
    );
  }
  if (sanitized.safeAnalysisSummary) {
    contextSections.push(`【已有解析/批改摘要】\n${sanitized.safeAnalysisSummary}`);
  }
  if (input.latestEvaluation) {
    const ev = input.latestEvaluation;
    contextSections.push(
      `【最新主观题批改报告】总分 ${ev.centralScore}/${ev.maxScore}；维度得分：${ev.dimensionScores
        .map((d) => `${d.name}:${d.score}/${d.maxScore}`)
        .join('，')}；待改任务：${ev.revisionTasks.map((t) => t.instruction).join('；')}`
    );
  }

  // Bounded sliding window of last 6 turns
  if (input.history && input.history.length > 0) {
    const recent = input.history.slice(-6);
    contextSections.push(
      `【最近多轮追问记录】\n${recent
        .map((h) => `${h.role === 'user' ? '考生' : '导师'}: ${h.content.slice(0, 400)}`)
        .join('\n')}`
    );
  }

  const prompt = `${contextSections.join('\n\n')}\n\n【考生当前追问】\n${input.userQuestion}\n\n请紧密结合上述真实题目材料、考生作答与批改报告给出针对性解答（控制在 300 字以内，条理清晰）：`;

  const answer = await provider.generateText(prompt, {
    temperature: 0.3,
    maxOutputTokens: 1200,
    signal: input.signal,
  });

  return {
    answer,
    leakedFieldsRemoved: sanitized.leakedFieldsRemoved,
    modelProvider: provider.providerId,
    modelName: provider.modelName,
    latencyMs: Date.now() - startMs,
  };
}

const WRITING_SCAFFOLD_SCHEMA = `{
  "paragraphPurposes": [
    {
      "paragraphIndex": 1,
      "title": "string",
      "purpose": "string",
      "recommendedWordCount": "string"
    }
  ],
  "argumentOrder": ["string"],
  "corePhraseBank": [
    { "phrase": "string", "usageNote": "string" }
  ],
  "sentenceSkeletons": [
    { "pattern": "string (含 ___ 填空留白，禁止代写整段成文)", "exampleSlot": "string" }
  ],
  "clozeSlots": [
    { "sentenceWithBlank": "string", "hint": "string" }
  ],
  "selfCheckQuestions": ["string"]
}`;

export async function runWritingScaffoldGeneration(
  provider: ModelProvider,
  input: {
    unitId: string;
    questionNumber: number;
    helpLevel: 1 | 2 | 3;
    questionPrompt: string;
    requiredFacts?: string[];
    images?: MultimodalImageInput[];
    signal?: AbortSignal;
  }
): Promise<WritingScaffoldResult> {
  const runId = `scaf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const prompt = `你是考研英语（一）写作与翻译结构化引导教练。
请针对第 ${input.questionNumber} 题生成 Level ${input.helpLevel} 审题与段落结构支架。
【严格边界禁令】绝不能直接替考生写出完整成篇范文或完整句子答案！句型骨架必须使用 ___ 留白供考生独立完成。
【题目要求】
${input.questionPrompt}
${
  input.requiredFacts && input.requiredFacts.length > 0
    ? `【图画/题目必含要素】\n${input.requiredFacts.join('；')}\n`
    : ''
}`;

  const rawData = await provider.generateStructured<
    Omit<
      WritingScaffoldResult,
      | 'runId'
      | 'unitId'
      | 'questionNumber'
      | 'helpLevel'
      | 'contentBoundaryNotice'
      | 'modelProvider'
      | 'modelName'
      | 'createdAt'
    >
  >(
    prompt,
    WRITING_SCAFFOLD_SCHEMA,
    (raw) => {
      if (!raw || typeof raw !== 'object') {
        return { valid: false, errors: ['Scaffold must be an object'] };
      }
      const obj = raw as Record<string, unknown>;
      if (!Array.isArray(obj.paragraphPurposes)) {
        return { valid: false, errors: ['paragraphPurposes must be an array'] };
      }
      return {
        valid: true,
        errors: [],
        value: {
          paragraphPurposes: obj.paragraphPurposes as WritingScaffoldResult['paragraphPurposes'],
          argumentOrder: Array.isArray(obj.argumentOrder)
            ? obj.argumentOrder.map(String)
            : [],
          corePhraseBank: Array.isArray(obj.corePhraseBank)
            ? (obj.corePhraseBank as WritingScaffoldResult['corePhraseBank'])
            : [],
          sentenceSkeletons: Array.isArray(obj.sentenceSkeletons)
            ? (obj.sentenceSkeletons as WritingScaffoldResult['sentenceSkeletons'])
            : [],
          clozeSlots: Array.isArray(obj.clozeSlots)
            ? (obj.clozeSlots as WritingScaffoldResult['clozeSlots'])
            : [],
          selfCheckQuestions: Array.isArray(obj.selfCheckQuestions)
            ? obj.selfCheckQuestions.map(String)
            : [],
        },
      };
    },
    { images: input.images, maxRetries: 1, signal: input.signal }
  );

  return {
    runId,
    unitId: input.unitId,
    questionNumber: input.questionNumber,
    helpLevel: input.helpLevel,
    ...rawData,
    contentBoundaryNotice:
      '本支架仅提供审题立意、段落推进顺序与留白句型骨架，不代写完整成文。',
    modelProvider: provider.providerId,
    modelName: provider.modelName,
    createdAt: new Date().toISOString(),
  };
}
