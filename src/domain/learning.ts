/**
 * User learning state contracts: Attempts, Immutable Subjective Version Trees,
 * Two-Stage Subjective Evaluations, Objective Deep Analyses, Scaffolds, and Review Queue.
 */

import type { ProviderType, TokenUsageSummary } from './ai.ts';
import type { OptionItem } from './paper.ts';
import type { SubjectId, SubjectiveUnitType, UnitType } from './subjects.ts';

export type ConfidenceLevel = 'certain' | 'hesitant' | 'guessed';

export type SubjectivePracticeMode = 'independent' | 'guided' | 'rewrite';

export interface HintRecord {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  content: string;
  usedAt: string;
}

export interface ObjectiveItemResponse {
  questionNumber: number;
  itemId: string;
  unitId: string;
  unitType: UnitType;
  selectedAnswer: string;
  confidence: ConfidenceLevel;
  flaggedForReview: boolean;
  timeSpentSeconds: number;
  isCorrect?: boolean;
  correctAnswer?: string;
  scoreEarned?: number;
  maxScore: number;
  knownErrorCauses: string[];
  possibleErrorCauses: string[];
  userNotes: string;
  highlights: { text: string; paragraphIndex?: number }[];
}

export interface SubjectiveAnswerVersion {
  id: string;
  attemptId: string;
  paperId?: string;
  subjectId?: SubjectId;
  year: number;
  dataVersion: string;
  unitId: string;
  unitType: SubjectiveUnitType;
  questionNumber: number;
  versionNumber: number;
  versionLabel: string; // e.g., V1 原稿, V2 修改稿, V3 延时重写
  practiceMode: SubjectivePracticeMode;
  content: string;
  subAnswers?: Record<number, string>; // For 46-50 / 34-38 individual question inputs
  wordCount: number;
  durationSeconds: number;
  usedHints: HintRecord[];
  parentVersionId: string | null;
  evaluationId: string | null;
  createdAt: string;
  deviceId: string;
  clientRevision: number;
}

export interface EvaluationAnnotation {
  id?: string;
  issueType:
    | 'grammar'
    | 'vocabulary'
    | 'coherence'
    | 'completeness'
    | 'register'
    | 'translation-accuracy'
    | 'chart-fact'
    | 'theory-principle'
    | 'material-link';
  quotedUserText: string;
  startOffset: number;
  endOffset: number;
  explanation: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
  anchorStatus?: 'exact' | 'nearest-repaired' | 'ambiguous';
  occurrenceCount?: number;
}

export interface AnnotationRenderSlice {
  sliceId: string;
  startOffset: number;
  endOffset: number;
  text: string;
  annotationIds: string[];
  annotations: EvaluationAnnotation[];
  highestSeverity: 'high' | 'medium' | 'low' | null;
  hasAmbiguousAnchor: boolean;
}

export interface RevisionVerificationItem {
  revisionTaskId: string;
  instruction: string;
  status: 'resolved' | 'partially-resolved' | 'unaddressed' | 'regressed';
  evidence: string;
  explanation: string;
}

export interface VersionScoreDelta {
  previousVersionId: string;
  previousVersionLabel: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  comparable: boolean;
  incomparabilityReason?: string;
  reasons: string[];
  resolvedCount: number;
  totalTasksCount: number;
  newIssues: string[];
  regressedIssues: string[];
}

export interface SubjectiveEvaluationResult {
  id: string;
  runId?: string;
  taskType: SubjectiveUnitType;
  taskId: string;
  answerVersionId: string;
  previousAnswerVersionId?: string | null;
  evaluationMode: 'deep-two-stage' | 'fast-single-stage';
  usedHints: boolean;
  centralScore: number;
  scoreRangeMin: number;
  scoreRangeMax: number;
  maxScore: number;
  confidence: 'high' | 'medium' | 'low';
  dimensionScores: {
    dimensionId: string;
    name: string;
    score: number;
    maxScore: number;
    rationale: string;
  }[];
  strengths: string[];
  issues: {
    category: string;
    description: string;
    evidence: string;
    deductionRationale: string;
  }[];
  annotations: EvaluationAnnotation[];
  revisionTasks: {
    id: string;
    priority: number;
    instruction: string;
    targetText?: string;
    completed?: boolean;
  }[];
  revisionVerification?: RevisionVerificationItem[];
  scoreDelta?: VersionScoreDelta;
  transferableLessons: string[];
  referenceContent: string;
  referenceContentSource: 'ai-generated' | 'source-provided';
  reviewerDecision:
    | 'approved'
    | 'adjusted'
    | 'provisional-stage2-failed'
    | 'skipped-fast-mode';
  reviewerAdjustments: {
    stage1Score: number;
    finalScore: number;
    scoreDelta: number;
    stabilityWarning: boolean;
    notes: string[];
    verifiedFactCoverage: boolean;
    dimensionAdjustments?: {
      dimensionId: string;
      stage1Score: number;
      finalScore: number;
      reason: string;
    }[];
  };
  modelProvider: ProviderType;
  modelName: string;
  stage2ModelProvider?: ProviderType;
  stage2ModelName?: string;
  usedVision?: boolean;
  visionDegradedToText?: boolean;
  imageAssetsUsed?: string[];
  usage?: TokenUsageSummary;
  retryCount?: number;
  latencyMs?: number;
  cacheStatus?: 'miss' | 'hit' | 'bypassed';
  promptVersion: string;
  createdAt: string;
}

export interface ObjectiveAIAnalysis {
  questionNumber: number;
  paperId?: string;
  subjectId?: SubjectId;
  year?: number;
  runId?: string;
  evidenceQuote: string;
  questionCategory: string;
  optionBreakdown: Record<string, string>;
  userChoiceAttraction?: string;
  distractorTrapType?: string;
  selfDiagnosisAssessment?: string;
  userMarkedErrorReasons?: string[];
  possibleErrorCauses: string[];
  nextTimeCheckAction?: string;
  transferableConclusion: string;
  dataQualityWarning?: string;
  modelProvider: string;
  modelName: string;
  usage?: TokenUsageSummary;
  latencyMs?: number;
  createdAt: string;
}

export interface WritingScaffoldResult {
  runId: string;
  unitId: string;
  questionNumber: number;
  helpLevel: 1 | 2 | 3;
  paragraphPurposes: {
    paragraphIndex: number;
    title: string;
    purpose: string;
    recommendedWordCount: string;
  }[];
  argumentOrder: string[];
  corePhraseBank: { phrase: string; usageNote: string }[];
  sentenceSkeletons: { pattern: string; exampleSlot: string }[];
  clozeSlots: { sentenceWithBlank: string; hint: string }[];
  selfCheckQuestions: string[];
  contentBoundaryNotice: string;
  modelProvider: ProviderType;
  modelName: string;
  createdAt: string;
}

export interface FollowUpTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  modelName?: string;
}

export interface ExamAttempt {
  id: string;
  paperId?: string;
  subjectId?: SubjectId;
  year: number;
  dataVersion: string;
  mode: 'unit-practice' | 'strict-simulation' | 'free-simulation';
  unitIds: string[];
  status: 'in-progress' | 'submitted';
  startedAt: string;
  submittedAt: string | null;
  elapsedSeconds: number;
  remainingSeconds?: number;
  objectiveResponses: Record<number, ObjectiveItemResponse>;
  subjectiveVersionIds: string[];
  totalObjectiveScore?: number;
  maxObjectiveScore?: number;
  updatedAt: string;
  serverUpdatedAt?: string;
  clientRevision: number;
  deviceId: string;
}

export type ReviewItemType =
  | 'objective-error'
  | 'objective-hesitant-error'
  | 'objective-confident-error'
  | 'objective-guessed-right'
  | 'objective-manual'
  | 're-translate'
  | 'revise-essay'
  | 're-analyze-politics'
  | 'rewrite-paragraph'
  | 'fix-sentence'
  | 'restructure-outline'
  | 'delayed-full-rewrite'
  | 'recurring-language-issue';

export interface ReviewItem {
  id: string;
  attemptId?: string;
  paperId?: string;
  subjectId?: SubjectId;
  year: number;
  dataVersion: string;
  unitId: string;
  unitType: UnitType;
  questionNumber: number;
  reviewType: ReviewItemType;
  title: string;
  promptSnapshot: string;
  optionsSnapshot?: OptionItem[];
  correctAnswerSnapshot?: string | null;
  previousUserAnswer: string;
  previousFeedbackSummary: string;
  knownErrorCauses: string[];
  intervalDays: number; // e.g., 1, 3, 7, 14, 30
  repetitionCount: number;
  mastered: boolean;
  nextDueAt: string;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientRevision: number;
  deviceId: string;
}

export type SyncStatus =
  | 'local-only'
  | 'cloud-unconfigured'
  | 'saved-local'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'sync-failed'
  | 'conflict';
