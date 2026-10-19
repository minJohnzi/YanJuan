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

// User Learning Records, Attempts, Versions, Evaluations, Review & Sync
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
  issueType: 'grammar' | 'vocabulary' | 'coherence' | 'completeness' | 'register' | 'translation-accuracy' | 'chart-fact';
  quotedUserText: string;
  startOffset: number;
  endOffset: number;
  explanation: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export interface SubjectiveEvaluationResult {
  id: string;
  taskType: 'translation' | 'practical-writing' | 'visual-writing';
  taskId: string;
  answerVersionId: string;
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
  transferableLessons: string[];
  referenceContent: string;
  referenceContentSource: 'ai-generated' | 'source-provided';
  reviewerDecision: 'approved' | 'adjusted' | 'provisional-stage2-failed' | 'skipped-fast-mode';
  reviewerAdjustments: {
    stage1Score: number;
    finalScore: number;
    scoreDelta: number;
    stabilityWarning: boolean;
    notes: string[];
    verifiedFactCoverage: boolean;
  };
  modelProvider: 'gemini' | 'deepseek' | 'openai-compatible';
  modelName: string;
  promptVersion: string;
  createdAt: string;
}

export interface ObjectiveAIAnalysis {
  questionNumber: number;
  evidenceQuote: string;
  questionCategory: string;
  optionBreakdown: Record<string, string>;
  possibleErrorCauses: string[];
  transferableConclusion: string;
  modelProvider: string;
  modelName: string;
  createdAt: string;
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
  provider: 'gemini' | 'deepseek' | 'openai-compatible';
  displayName: string;
  defaultModel: string;
  supportsVision: boolean;
  supportsJsonObject: boolean;
  supportsJsonSchema: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  maxInput: number;
  maxOutput: number;
}

export interface ProviderCredentialStatus {
  provider: 'gemini' | 'deepseek' | 'openai-compatible';
  configured: boolean;
  storageMode: 'none' | 'session-cookie' | 'encrypted-firestore' | 'owner-env';
  maskedKey: string | null;
  baseUrl?: string;
  model: string;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | 'untested';
}
