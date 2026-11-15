/**
 * Exam paper structural models, validation report contracts, and manifest types.
 * Zero I/O — shared cleanly across client, server, and build pipeline.
 */

import type { ExamSubject, PaperIdentity, SubjectId, UnitType } from './subjects.ts';

export type AnswerMode =
  | 'single-choice'
  | 'multi-choice'
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
  knowledgeModule?: string;
  officialExplanation?: string;
  subQuestions?: string[];
  answerKeyPoints?: string;
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
  materialType:
    | 'passage'
    | 'cloze-passage'
    | 'assembly-stem'
    | 'translation-passage'
    | 'writing-prompt'
    | 'visual-illustration'
    | 'analysis-material';
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
  paperId?: string;
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
  paperId?: string;
  subjectId?: SubjectId;
  examYear?: number;
  seriesCode?: 'real-exam' | 'xiao8';
  badgeLabel?: string;
  year: number;
  subject: ExamSubject;
  setNumber?: number;
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
  identity?: PaperIdentity;
}

export interface ExamAnswerKeyEntry {
  questionNumber: number;
  correctAnswer: string | null;
  answerSource: AnswerSource;
  officialExplanation?: string;
  answerKeyPoints?: string;
  referenceTranslation?: string | null;
  referenceText?: string;
  dataQuality?: DataQualityConflictInfo;
}

export interface ExamAnswerKeyFile {
  paperId: string;
  subjectId: SubjectId;
  legacyYear: number;
  dataVersion: string;
  generatedAt: string;
  items: Record<number, ExamAnswerKeyEntry>;
}

export interface YearManifestEntry {
  year: number;
  paperId?: string;
  subjectId?: SubjectId;
  examYear?: number;
  badgeLabel?: string;
  subject?: ExamSubject;
  paperTitle?: string;
  setNumber?: number;
  totalQuestions?: number;
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

export interface SubjectManifestSummary {
  subjectId: SubjectId;
  name: string;
  shortName: string;
  expectedCount: number;
  readyCount: number;
  paperIds: string[];
  legacyYears: number[];
}

export interface PapersManifest {
  schemaVersion: string;
  buildTime: string;
  expectedYears: number[];
  availableYears: number[];
  availablePaperIds?: string[];
  pendingYears: number[];
  failedYears: number[];
  latestReadyVersion: Record<string, string>;
  sourceFormats: Record<string, ('md' | 'pdf' | 'docx')[]>;
  unitTypes: Record<string, UnitType[]>;
  validationStatus: Record<string, ImportStatus>;
  subjects?: Partial<Record<SubjectId, SubjectManifestSummary>>;
  years: YearManifestEntry[];
}
