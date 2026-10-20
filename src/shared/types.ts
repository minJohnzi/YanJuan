export type UnitType =
  | 'cloze'
  | 'reading'
  | 'passage-assembly'
  | 'translation'
  | 'practical-writing'
  | 'visual-writing';

export type AnswerMode =
  | 'single-choice'
  | 'sequence'
  | 'short-text'
  | 'long-text';

export type AnswerSource =
  | 'source-provided'
  | 'ai-generated'
  | 'unavailable';

export type ImportStatus =
  | 'ready'
  | 'needs-answer-source'
  | 'failed'
  | 'pending';

export type ConfidenceLevel = 'certain' | 'hesitant' | 'guessed';

export type AIErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_TOKEN_INVALID'
  | 'PROVIDER_CREDENTIAL_MISSING'
  | 'PROVIDER_AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_LIST_UNSUPPORTED'
  | 'MODEL_CAPABILITY_MISMATCH'
  | 'STRUCTURED_OUTPUT_UNSUPPORTED'
  | 'STRUCTURED_OUTPUT_INVALID'
  | 'VISION_NOT_SUPPORTED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_CANCELLED'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_BASE_URL'
  | 'UNSAFE_BASE_URL'
  | 'EVALUATION_CONFLICT'
  | 'DATA_ANSWER_DISPUTED'
  | 'INTERNAL_CONFIGURATION_ERROR';

export interface SourceLocator {
  sourceFile: string;
  sourceFormat: 'md' | 'pdf' | 'docx';
  sectionHeading?: string;
  pageNumber?: number;
  lineRange?: [number, number];
  charRange?: [number, number];
  boundingBox?: [number, number, number, number];
}

export interface OptionItem {
  key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  text: string;
}

export interface RubricDimension {
  id: string;
  name: string;
  maxScore: number;
  description: string;
}

export interface ItemRubric {
  maxScore: number;
  dimensions: RubricDimension[];
  keyPoints?: string[];
  syntacticNotes?: string[];
  referenceText?: string;
  referenceSource?: AnswerSource;
}

export interface DataQualityConflictInfo {
  status: 'verified' | 'disputed';
  code?: 'DATA_ANSWER_DISPUTED';
  paperSourceFile: string;
  answerSourceFile?: string;
  markedAnswer: string | null;
  semanticCandidateAnswer?: string | null;
  reason: string;
  detectedAt: string;
}

export interface ExamItem {
  id: string;
  questionNumber: number;
  answerMode: AnswerMode;
  prompt: string;
  options?: OptionItem[];
  score: number;
  correctAnswer: string | null;
  answerSource: AnswerSource;
  rubric?: ItemRubric;
  sourceLocator: SourceLocator;
  dataQuality?: DataQualityConflictInfo;
  // Type-specific structured metadata
  clozeContext?: {
    sentence: string;
    surroundingParagraph: string;
    blankIndex: number;
  };
  readingMeta?: {
    passageId: string;
    paragraphNumbers?: number[];
    questionCategory?: 'detail' | 'inference' | 'main-idea' | 'attitude' | 'vocab-in-context';
    underlinedTarget?: string;
  };
  translationMeta?: {
    underlinedEnglish: string;
    contextParagraph: string;
    charRange: [number, number];
    keySemanticPoints: string[];
    syntacticRelations: string[];
    referenceTranslation: string | null;
    referenceSource: AnswerSource;
  };
}

export interface VisualMaterial {
  id: string;
  imagePath: string;
  visualType: 'single-cartoon' | 'single-chart' | 'multi-chart' | 'image-text' | 'other';
  title: string;
  caption?: string;
  categories: string[];
  values: { label: string; value: number; unit: string }[];
  unit: string;
  primaryRelations: string[];
  requiredFacts: string[];
  sourceLocator: SourceLocator;
}

export interface PracticalWritingSpec {
  genre: string;
  writerIdentity: string;
  targetAudience: string;
  backgroundMaterial: string;
  requiredPoints: string[];
  salutationRequirement: string;
  signatureRequirement: string;
  wordCountRange: [number, number];
  score: number;
  dimensions: RubricDimension[];
}

export interface PassageAssemblySpec {
  subType: 'paragraph-fill' | 'paragraph-order' | 'heading-match' | 'info-match';
  candidateParagraphs: { id: string; label: string; text: string }[];
  fixedPlacements: { positionIndex: number; paragraphId: string; text: string }[];
  scoredPositions: { positionIndex: number; questionNumber: number }[];
  sequenceSlots: {
    positionIndex: number;
    type: 'fixed' | 'blank';
    fixedParagraphId?: string;
    questionNumber?: number;
  }[];
  finalOrder: (string | null)[];
  redundantOptions: string[];
  redundantCount: number;
  allowRepeat: boolean;
}

export interface ExamMaterial {
  id: string;
  materialType: 'passage' | 'cloze-passage' | 'assembly-stem' | 'translation-passage' | 'writing-prompt' | 'visual-illustration';
  title?: string;
  text: string;
  paragraphs?: string[];
  imagePath?: string;
  ocrText?: string;
  multimodalDescription?: string;
  extractedFacts?: string[];
  sourcePage?: number;
  sourceBoundingBox?: [number, number, number, number];
  relatedItemIds: string[];
  passageAssemblySpec?: PassageAssemblySpec;
  practicalWritingSpec?: PracticalWritingSpec;
  visualMaterials?: VisualMaterial[];
}

export interface ExamUnit {
  id: string;
  sectionId: string;
  unitType: UnitType;
  title: string;
  instructions: string;
  score: number;
  suggestedMinutes: number;
  materials: ExamMaterial[];
  items: ExamItem[];
  analysisProfile: {
    focusSkills: string[];
    commonTraps: string[];
  };
  reviewStrategy: {
    defaultIntervalsDays: number[];
    recommendedAction: string;
  };
  sourceLocator: SourceLocator;
}

export interface ExamSection {
  id: string;
  title: string;
  sectionNumber: string;
  score: number;
  suggestedMinutes: number;
  units: ExamUnit[];
}

export type ValidationErrorCode =
  | 'OBJECTIVE_ANSWER_MISSING'
  | 'OBJECTIVE_ANSWER_CONFLICT'
  | 'DATA_ANSWER_DISPUTED'
  | 'AI_GUESSED_OBJECTIVE_ANSWER_FORBIDDEN'
  | 'QUESTION_NUMBER_GAP'
  | 'QUESTION_NUMBER_DUPLICATE'
  | 'QUESTION_NUMBER_OUT_OF_ORDER'
  | 'CLOZE_COUNT_INVALID'
  | 'CLOZE_OPTIONS_INVALID'
  | 'READING_PART_A_INVALID'
  | 'PART_B_SLOTS_INVALID'
  | 'PART_B_FIXED_PARAGRAPH_INVALID'
  | 'TRANSLATION_COUNT_INVALID'
  | 'WRITING_SECTION_MISSING'
  | 'WRITING_VISUAL_MATERIAL_INVALID'
  | 'TOTAL_SCORE_MISMATCH'
  | 'INVALID_ASSET_PATH'
  | 'ANSWER_SHEET_LEAKED_INTO_PASSAGE'
  | 'PIE_CHART_SUM_INVALID'
  | 'DUPLICATE_FILE_HASH'
  | 'SUBJECT_OR_YEAR_INVALID';

export interface ValidationCheckResult {
  checkId: string;
  name: string;
  passed: boolean;
  code?: ValidationErrorCode;
  message: string;
  details?: string[];
}

export interface ValidationReport {
  examId: string;
  year: number;
  dataVersion: string;
  status: ImportStatus;
  passedAllChecks: boolean;
  errorCodes: ValidationErrorCode[];
  missingObjectiveQuestions: number[];
  conflictingObjectiveQuestions: number[];
  disputedQuestions?: {
    questionNumber: number;
    markedAnswer: string | null;
    semanticCandidateAnswer?: string | null;
    reason: string;
    paperSourceFile: string;
    answerSourceFile?: string;
  }[];
  checks: ValidationCheckResult[];
  consistencyCheckRuns: number;
  consistencyMatched: boolean;
  sourceDiscrepancies: {
    locator: string;
    mdText?: string;
    pdfText?: string;
    docxText?: string;
    resolution: string;
  }[];
  generatedAt: string;
}

export interface Exam {
  id: string;
  year: number;
  subject: '考研英语一';
  totalScore: number;
  durationMinutes: number;
  sourceFiles: string[];
  sourceFormats: ('md' | 'pdf' | 'docx')[];
  sourceHashes: Record<string, string>;
  pageCount: number;
  importStatus: ImportStatus;
  importRetryCount: number;
  parserProvider: string;
  parserModel: string;
  parserVersion: string;
  schemaVersion: string;
  dataVersion: string;
  sections: ExamSection[];
  validationReport: ValidationReport;
  createdAt: string;
  updatedAt: string;
  paperTitle?: string;
  status?: ImportStatus;
  answerSourceStatus?: AnswerSource;
  objectiveAnswerCount?: number;
  subjectiveCount?: number;
  referencedAssets?: string[];
}

export interface YearManifestEntry {
  year: number;
  status: ImportStatus;
  latestReadyVersion: string | null;
  latestCandidateVersion: string | null;
  availableVersions: string[];
  sourceFormats: ('md' | 'pdf' | 'docx')[];
  unitTypes: UnitType[];
  validationStatus: ImportStatus;
  errorCodes: ValidationErrorCode[];
  missingObjectiveCount: number;
  disputedQuestionCount?: number;
  hasNewerCandidate: boolean;
  updatedAt: string | null;
}

export interface PapersManifest {
  schemaVersion: string;
  buildTime: string;
  expectedYears: number[];
  availableYears: number[];
  pendingYears: number[];
  failedYears: number[];
  latestReadyVersion: Record<string, string>;
  sourceFormats: Record<string, ('md' | 'pdf' | 'docx')[]>;
  unitTypes: Record<string, UnitType[]>;
  validationStatus: Record<string, ImportStatus>;
  years: YearManifestEntry[];
}

// ============================================================================
// Four-Layer AI Architecture: Connection -> ModelProfile -> TaskBinding -> Run
// ============================================================================

export type ProviderType = 'gemini' | 'deepseek' | 'openai-compatible';

export type CapabilitySource =
  | 'provider'
  | 'verified'
  | 'inferred'
  | 'manual'
  | 'unknown';

export type StructuredOutputStrategy =
  | 'json_schema'
  | 'json_object'
  | 'prompt_only';

export type ProtocolMode =
  | 'chat-completions'
  | 'gemini-native';

export type AITaskType =
  | 'objective_explanation'
  | 'subjective_stage1'
  | 'subjective_stage2'
  | 'visual_writing'
  | 'followup_chat'
  | 'writing_scaffold';

export interface ProviderConnection {
  id: string;
  ownerUid: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl: string;
  protocolMode: ProtocolMode;
  authenticationType: 'bearer' | 'x-goog-api-key';
  credentialReference: string;
  maskedKey: string;
  storageMode: 'persistent-encrypted' | 'session-only' | 'owner-env';
  enabled: boolean;
  configurationHash: string;
  lastTestStatus: 'success' | 'failed' | 'untested' | 'invalidated';
  lastTestedAt: string | null;
  lastErrorCode?: AIErrorCode | null;
  lastErrorMessage?: string | null;
  extraHeaders?: Record<string, string>;
  modelsListPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCapabilityMatrix {
  text: boolean;
  structuredOutput: boolean;
  jsonSchema: boolean;
  jsonObject: boolean;
  vision: boolean;
  streaming: boolean;
  reasoning: boolean;
}

export interface ModelProfile {
  id: string;
  connectionId: string;
  ownerUid: string;
  providerType: ProviderType;
  modelId: string;
  displayName: string;
  source: 'provider-list' | 'manual';
  capabilities: ModelCapabilityMatrix;
  capabilitySource: {
    text: CapabilitySource;
    structuredOutput: CapabilitySource;
    vision: CapabilitySource;
    streaming: CapabilitySource;
    reasoning: CapabilitySource;
  };
  contextWindow: number | null;
  outputLimit: number | null;
  structuredOutputStrategy: StructuredOutputStrategy;
  defaultParameters: {
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };
  configurationHash: string;
  lastVerifiedAt: string | null;
  lastTestLayers?: {
    basic?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
    structured?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
    vision?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
    sample?: { ok: boolean; latencyMs: number; testedAt: string; message: string };
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskBindingConfig {
  taskType: AITaskType;
  primaryModelProfileId: string | null;
  fallbackModelProfileId: string | null;
  timeoutMs: number;
  retryBudget: number;
  temperature: number;
  maxOutputTokens: number;
  structuredOutputStrategy: StructuredOutputStrategy;
  promptVersion: string;
  allowTextFallbackForVision?: boolean;
  enabled: boolean;
  updatedAt: string;
}

export interface DiscoveredModelItem {
  modelId: string;
  displayName: string;
  providerType: ProviderType;
  source: 'provider-list';
  contextWindow: number | null;
  outputLimit: number | null;
  capabilities: Partial<ModelCapabilityMatrix>;
  capabilitySource: CapabilitySource;
  fetchedAt: string;
}

export interface ModelDiscoveryResult {
  connectionId?: string;
  providerType: ProviderType;
  normalizedBaseUrl: string;
  models: DiscoveredModelItem[];
  source: 'provider-api' | 'cached-provider-api';
  fetchedAt: string;
  expiresAt: string;
  supported: boolean;
  warningCode?: AIErrorCode;
  warningMessage?: string;
}

export interface MultiLayerTestLayerResult {
  layer: 'basic' | 'structured' | 'vision' | 'sample';
  ok: boolean;
  latencyMs: number;
  message: string;
  errorCode?: AIErrorCode;
  details?: string;
}

export interface MultiLayerTestResponse {
  ok: boolean;
  providerType: ProviderType;
  normalizedBaseUrl: string;
  modelId: string;
  protocolMode: ProtocolMode;
  configurationHash: string;
  testedAt: string;
  totalLatencyMs: number;
  layers: MultiLayerTestLayerResult[];
  verifiedCapabilities: Partial<ModelCapabilityMatrix>;
  capabilitySources: Partial<Record<keyof ModelCapabilityMatrix, CapabilitySource>>;
}

export interface TokenUsageSummary {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  source: 'provider' | 'unknown';
}

export interface EvaluationRun {
  runId: string;
  userId: string;
  taskType: AITaskType;
  answerVersionId?: string;
  previousAnswerVersionId?: string | null;
  questionNumber?: number;
  inputHash: string;
  rubricHash: string;
  promptVersion: string;
  taskBindingVersion: string;
  modelProfileId: string;
  connectionId: string;
  provider: ProviderType;
  actualModelId: string;
  stage2ModelProfileId?: string | null;
  stage2Provider?: ProviderType | null;
  stage2ActualModelId?: string | null;
  status:
    | 'queued'
    | 'running-stage1'
    | 'stage1-ready'
    | 'running-stage2'
    | 'completed'
    | 'provisional-stage2-failed'
    | 'cancelled'
    | 'failed';
  startedAt: string;
  completedAt: string | null;
  stage1LatencyMs?: number;
  stage2LatencyMs?: number;
  latencyMs: number;
  retryCount: number;
  cacheStatus: 'miss' | 'hit' | 'bypassed';
  usage: TokenUsageSummary;
  stage2Usage?: TokenUsageSummary;
  estimatedCostUsd: number | null;
  finishReason: string | null;
  providerRequestId: string | null;
  usedVision: boolean;
  visionDegradedToText: boolean;
  stage1Result?: unknown;
  stage2Result?: unknown;
  finalResult?: unknown;
  safeErrorCode?: AIErrorCode | null;
  errorMessage?: string | null;
}

export interface UserAIWorkspaceConfig {
  ownerUid: string;
  defaultModelProfileId: string | null;
  connections: ProviderConnection[];
  modelProfiles: ModelProfile[];
  taskBindings: Record<AITaskType, TaskBindingConfig>;
  dailyBudgetUsd: number;
  dailySpentUsd: number;
  maxConcurrentJobs: number;
  updatedAt: string;
}

// ============================================================================
// User Learning Records, Attempts, Versions, Evaluations, Review & Sync
// ============================================================================

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
  year: number;
  dataVersion: string;
  unitId: string;
  unitType: 'translation' | 'practical-writing' | 'visual-writing';
  questionNumber: number;
  versionNumber: number;
  versionLabel: string; // e.g., V1 原稿, V2 修改稿, V3 延时重写
  practiceMode: SubjectivePracticeMode;
  content: string;
  subAnswers?: Record<number, string>; // For 46-50 individual translation inputs
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
    | 'chart-fact';
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
  taskType: 'translation' | 'practical-writing' | 'visual-writing';
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
  | 'rewrite-paragraph'
  | 'fix-sentence'
  | 'restructure-outline'
  | 'delayed-full-rewrite'
  | 'recurring-language-issue';

export interface ReviewItem {
  id: string;
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
  | 'cloud-unconfigured'
  | 'saved-local'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'sync-failed'
  | 'conflict';

export interface ModelCapabilities {
  provider: ProviderType;
  displayName: string;
  defaultModel: string;
  supportsVision: boolean;
  supportsJsonObject: boolean;
  supportsJsonSchema: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  maxInput: number;
  maxOutput: number;
  capabilitySource?: CapabilitySource;
}

export interface ProviderCredentialStatus {
  provider: ProviderType;
  configured: boolean;
  storageMode: 'none' | 'session-cookie' | 'encrypted-firestore' | 'owner-env';
  maskedKey: string | null;
  baseUrl?: string;
  model: string;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | 'untested';
  connectionId?: string;
  displayName?: string;
  configurationHash?: string;
}
