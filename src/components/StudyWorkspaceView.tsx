import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Clock,
  CheckCircle2,
  Flag,
  Layers,
  Pause,
  Play,
  Sliders,
  Highlighter,
  X,
  CheckSquare,
  Square,
  Check,
  ClipboardList,
  RotateCcw,
} from 'lucide-react';
import type {
  ConfidenceLevel,
  Exam,
  ExamAttempt,
  ExamItem,
  ExamUnit,
  HintRecord,
  ObjectiveAIAnalysis,
  ObjectiveItemResponse,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
  SubjectivePracticeMode,
  SubjectiveUnitType,
  WritingScaffoldResult,
} from '../shared/types';
import {
  formatExamTitle,
  isPoliticsExamYear,
} from '../shared/types';
import { computeVersionDiff } from '../shared/schemaValidator';
import { examTimerStore, useTimerSnapshot } from '../hooks/useTimerStore';
import { ReadingTypographyPrefs } from '../services/storageAndSync';
import { ModalDialog, SegmentedTabs } from './ui/primitives';
import { ObjectiveQuestionCard } from './workspace/ObjectiveQuestionCard';
import { EnglishSubjectiveStudio } from './workspace/EnglishSubjectiveStudio';
import { PoliticsAnalysisStudio } from './workspace/PoliticsAnalysisStudio';

function formatTimerClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

const WorkspaceTimerControls: React.FC<{
  mode: ExamAttempt['mode'];
  durationMinutes: number;
  isSubmitted: boolean;
  isStrictSimulation: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
}> = React.memo(
  ({
    mode,
    durationMinutes,
    isSubmitted,
    isStrictSimulation,
    isPaused,
    onTogglePause,
  }) => {
    const timer = useTimerSnapshot();
    const remainingSimulationSec = Math.max(
      0,
      durationMinutes * 60 - timer.elapsedSeconds
    );

    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-50 dark:bg-[#162226] border border-stone-200 dark:border-[#2C3E46] rounded-lg text-xs font-tabular-mono text-stone-800 dark:text-[#E2E8E6]">
        <Clock className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
        <span>
          {mode === 'unit-practice'
            ? `用时 ${formatTimerClock(timer.elapsedSeconds)}`
            : `剩余 ${formatTimerClock(remainingSimulationSec)}`}
        </span>
        {!isStrictSimulation && !isSubmitted && (
          <button
            type="button"
            aria-label={isPaused ? '继续计时' : '暂停计时'}
            onClick={onTogglePause}
            className="ml-1 text-[#174A5B] dark:text-[#75B6CE] hover:underline inline-flex items-center gap-0.5 font-medium"
          >
            {isPaused ? (
              <Play className="w-3 h-3 fill-current" />
            ) : (
              <Pause className="w-3 h-3 fill-current" />
            )}
            <span>{isPaused ? '继续' : '暂停'}</span>
          </button>
        )}
      </div>
    );
  }
);

const SubjectiveTimerReadout: React.FC<{ baseElapsedSeconds: number }> =
  React.memo(({ baseElapsedSeconds }) => {
    const timer = useTimerSnapshot();
    const elapsed = Math.max(0, timer.elapsedSeconds - baseElapsedSeconds);
    return (
      <div className="text-xs font-tabular-mono text-[#174A5B] dark:text-[#75B6CE]">
        本稿计时：{formatTimerClock(elapsed)}
      </div>
    );
  });

interface StudyWorkspaceViewProps {
  exam: Exam;
  activeUnitId: string;
  initialFocusQuestion?: number | null;
  attempt: ExamAttempt;
  subjectiveVersions: SubjectiveAnswerVersion[];
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  objectiveAnalyses: Record<string, ObjectiveAIAnalysis>;
  anyModelAvailable: boolean;
  activeProviderName: string | null;
  typographyPrefs: ReadingTypographyPrefs;
  onUpdateTypographyPrefs: (prefs: ReadingTypographyPrefs) => void;
  onSelectUnit: (unitId: string) => void;
  onRestartFreshPaper?: () => void;
  onUpdateObjectiveResponse: (
    questionNumber: number,
    patch: Partial<ObjectiveItemResponse>
  ) => void;
  onTickTimer?: (deltaSeconds: number) => void;
  onSubmitAttempt: () => void;
  onSubmitSubjectiveVersion: (params: {
    unitId: string;
    unitType: SubjectiveUnitType;
    questionNumber: number;
    practiceMode: SubjectivePracticeMode;
    content: string;
    subAnswers?: Record<number, string>;
    durationSeconds: number;
    usedHints: HintRecord[];
  }) => SubjectiveAnswerVersion;
  onRequestSubjectiveEvaluation: (
    version: SubjectiveAnswerVersion,
    unit: ExamUnit
  ) => Promise<void>;
  onRequestObjectiveAnalysis: (
    item: ExamItem,
    unit: ExamUnit,
    userAnswer: string,
    confidence: ConfidenceLevel
  ) => Promise<void>;
  onAskFollowUp: (params: {
    questionNumber: number;
    questionContext: string;
    userQuestion: string;
    previousAnalysisSummary?: string;
    unitId?: string;
    unitTitle?: string;
    passageText?: string;
    promptText?: string;
    userAnswer?: string;
    isSubmitted?: boolean;
  }) => Promise<string>;
  onRequestWritingScaffold?: (params: {
    unitType: 'translation' | 'practical-writing' | 'visual-writing';
    promptText: string;
    requiredFacts?: string[];
  }) => Promise<WritingScaffoldResult>;
  onExitWorkspace: () => void;
  onNavigateSettings: () => void;
  onOpenQuickChecker?: () => void;
}

const KNOWN_ERROR_CAUSE_OPTIONS = [
  '词汇或短语盲区',
  '长难句语法结构误判',
  '原文定位区间偏差',
  '过度推理或主观臆断',
  '混淆偷换概念干扰项',
  '审题粗心看错题干要求',
];

export const StudyWorkspaceView: React.FC<StudyWorkspaceViewProps> = ({
  exam,
  activeUnitId,
  initialFocusQuestion = null,
  attempt,
  subjectiveVersions,
  subjectiveEvaluations,
  objectiveAnalyses,
  anyModelAvailable,
  activeProviderName,
  typographyPrefs,
  onUpdateTypographyPrefs,
  onSelectUnit,
  onRestartFreshPaper,
  onUpdateObjectiveResponse,
  onSubmitAttempt,
  onSubmitSubjectiveVersion,
  onRequestSubjectiveEvaluation,
  onRequestObjectiveAnalysis,
  onAskFollowUp,
  onRequestWritingScaffold,
  onExitWorkspace,
  onNavigateSettings,
  onOpenQuickChecker,
}) => {
  const allUnits = useMemo(
    () => exam.sections.flatMap((sec) => sec.units),
    [exam]
  );
  const currentUnit = useMemo(
    () => allUnits.find((u) => u.id === activeUnitId) || allUnits[0],
    [allUnits, activeUnitId]
  );

  const [isPaused, setIsPaused] = useState(false);
  const [showAnswerSheet, setShowAnswerSheet] = useState(false);
  const [showPrefsPopover, setShowPrefsPopover] = useState(false);
  const [submitConfirmModal, setSubmitConfirmModal] = useState(false);
  const [reviewDensity, setReviewDensity] = useState<'compact' | 'comfortable'>('compact');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'wrong' | 'flagged'>('all');
  const [activeQuestionNumber, setActiveQuestionNumber] = useState<number>(
    initialFocusQuestion || currentUnit?.items[0]?.questionNumber || 1
  );
  const [questionDisplayMode, setQuestionDisplayMode] = useState<'single' | 'all'>('single');
  const [mobileReadingTab, setMobileReadingTab] = useState<'article' | 'questions'>('questions');
  const [splitPaneRatio, setSplitPaneRatio] = useState<'5:7' | '6:6' | '7:5'>('7:5');
  const [highlightedParagraphKey, setHighlightedParagraphKey] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const pendingUnitJumpRef = useRef<{
    unitId: string;
    qNum: number;
    isPartB: boolean;
  } | null>(null);

  // Reading Highlight & Note state
  const [highlightedQuotes, setHighlightedQuotes] = useState<
    Record<string, string[]>
  >({});

  // Part B active slot selection
  const [selectedPartBSlot, setSelectedPartBSlot] = useState<number>(41);

  // Subjective practice states (isolated by exam year and unit)
  const [practiceModeByKey, setPracticeModeByKey] = useState<
    Record<string, SubjectivePracticeMode>
  >({});
  const [usedHintsByKey, setUsedHintsByKey] = useState<
    Record<string, HintRecord[]>
  >({});
  const [translationInputsByYear, setTranslationInputsByYear] = useState<
    Record<number, Record<number, string>>
  >({});
  const [writingDraftByKey, setWritingDraftByKey] = useState<
    Record<string, string>
  >({});

  const subjectiveUnitKey = `${exam.year}:${currentUnit?.id || 'default'}`;
  const practiceMode: SubjectivePracticeMode =
    practiceModeByKey[subjectiveUnitKey] || 'independent';
  const setPracticeMode = (mode: SubjectivePracticeMode) =>
    setPracticeModeByKey((prev) => ({ ...prev, [subjectiveUnitKey]: mode }));
  const usedHints = useMemo<HintRecord[]>(
    () => usedHintsByKey[subjectiveUnitKey] || [],
    [usedHintsByKey, subjectiveUnitKey]
  );
  const setUsedHints = (
    updater: HintRecord[] | ((prev: HintRecord[]) => HintRecord[])
  ) =>
    setUsedHintsByKey((prev) => {
      const current = prev[subjectiveUnitKey] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [subjectiveUnitKey]: next };
    });
  const translationInputs = useMemo<Record<number, string>>(
    () =>
      translationInputsByYear[exam.year] || {
        46: '',
        47: '',
        48: '',
        49: '',
        50: '',
      },
    [translationInputsByYear, exam.year]
  );
  const setTranslationInputs = (
    updater:
      | Record<number, string>
      | ((prev: Record<number, string>) => Record<number, string>)
  ) =>
    setTranslationInputsByYear((prev) => {
      const current = prev[exam.year] || {
        46: '',
        47: '',
        48: '',
        49: '',
        50: '',
      };
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [exam.year]: next };
    });
  const writingDraft = writingDraftByKey[subjectiveUnitKey] || '';
  const setWritingDraft = (val: string) =>
    setWritingDraftByKey((prev) => ({ ...prev, [subjectiveUnitKey]: val }));
  const subjectiveBaseSecRef = useRef<number>(attempt.elapsedSeconds);
  const [subjectiveBaseSec, setSubjectiveBaseSec] = useState<number>(
    attempt.elapsedSeconds
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );
  const [compareBaseVersionId, setCompareBaseVersionId] = useState<
    string | null
  >(null);
  const [showDiffPanel, setShowDiffPanel] = useState<boolean>(false);

  // AI loading & error states
  const [evaluatingVersionId, setEvaluatingVersionId] = useState<string | null>(
    null
  );
  const [analyzingQuestionNum, setAnalyzingQuestionNum] = useState<
    number | null
  >(null);
  const [aiErrorBanner, setAiErrorBanner] = useState<string | null>(null);

  // Follow-up Q&A state (isolated by exam year + question number)
  const [followUpHistory, setFollowUpHistory] = useState<
    Record<string, { q: string; a: string }[]>
  >({});
  const [askingFollowUpQ, setAskingFollowUpQ] = useState<number | null>(null);
  const [aiScaffolds, setAiScaffolds] = useState<
    Record<string, WritingScaffoldResult>
  >({});
  const [loadingScaffold, setLoadingScaffold] = useState<boolean>(false);

  const isStrictSimulation = attempt.mode === 'strict-simulation';
  const isSubmitted = attempt.status === 'submitted';
  const isPoliticsWorkspace =
    exam.subject === '考研政治' ||
    isPoliticsExamYear(exam.year) ||
    currentUnit?.unitType.startsWith('politics-');
  const isCompactReview = isSubmitted && reviewDensity === 'compact';

  useEffect(() => {
    setReviewFilter('all');
  }, [attempt.id]);

  useEffect(() => {
    if (initialFocusQuestion) {
      setActiveQuestionNumber(initialFocusQuestion);
      if (currentUnit?.unitType === 'passage-assembly') {
        setSelectedPartBSlot(initialFocusQuestion);
      }
      window.setTimeout(() => {
        document
          .getElementById(`question-card-${initialFocusQuestion}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    }
  }, [initialFocusQuestion, attempt.id, exam.year]);

  useEffect(() => {
    const pending = pendingUnitJumpRef.current;
    if (pending && pending.unitId === currentUnit?.id) {
      pendingUnitJumpRef.current = null;
      setActiveQuestionNumber(pending.qNum);
      if (pending.isPartB) {
        setSelectedPartBSlot(pending.qNum);
      }
    } else if (!initialFocusQuestion) {
      if (currentUnit?.items[0]) {
        setActiveQuestionNumber(currentUnit.items[0].questionNumber);
      }
      const firstPartBSlot =
        currentUnit?.unitType === 'passage-assembly'
          ? currentUnit.items[0]?.questionNumber || 41
          : 41;
      setSelectedPartBSlot(firstPartBSlot);
    }
    setShowDiffPanel(false);
    setAiErrorBanner(null);
  }, [currentUnit?.id, exam.year]);

  const unitVersions = useMemo(() => {
    if (!currentUnit) return [];
    const qNum = currentUnit.items[0]?.questionNumber;
    return subjectiveVersions
      .filter(
        (v) =>
          v.year === exam.year &&
          v.dataVersion === exam.dataVersion &&
          (v.unitId === currentUnit.id || v.questionNumber === qNum)
      )
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }, [subjectiveVersions, exam.year, exam.dataVersion, currentUnit]);

  const latestUnitVersionId = unitVersions[unitVersions.length - 1]?.id || null;

  useEffect(() => {
    if (unitVersions.length > 0) {
      const latest = unitVersions[unitVersions.length - 1];
      setSelectedVersionId(latest.id);
      if (unitVersions.length >= 2) {
        setCompareBaseVersionId(unitVersions[unitVersions.length - 2].id);
      } else {
        setCompareBaseVersionId(unitVersions[0].id);
      }
    } else {
      setSelectedVersionId(null);
      setCompareBaseVersionId(null);
    }
  }, [unitVersions.length, latestUnitVersionId, currentUnit?.id, exam.year, exam.dataVersion]);

  // Sync isolated external timer store without re-rendering full workspace on 1s ticks
  useEffect(() => {
    const paused = isSubmitted || (isPaused && !isStrictSimulation);
    examTimerStore.syncAttempt(attempt.id, attempt.elapsedSeconds, paused);
  }, [attempt.id, attempt.elapsedSeconds, isSubmitted, isPaused, isStrictSimulation]);

  useEffect(() => {
    const snap = examTimerStore.getSnapshot();
    const base =
      snap.attemptId === attempt.id ? snap.elapsedSeconds : attempt.elapsedSeconds;
    subjectiveBaseSecRef.current = base;
    setSubjectiveBaseSec(base);
  }, [currentUnit?.id, attempt.id]);

  // Close modals on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAnswerSheet(false);
        setShowPrefsPopover(false);
        setSubmitConfirmModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const getCurrentSubjectiveElapsed = () => {
    const snap = examTimerStore.getSnapshot();
    const nowSec =
      snap.attemptId === attempt.id ? snap.elapsedSeconds : attempt.elapsedSeconds;
    return Math.max(0, nowSec - subjectiveBaseSecRef.current);
  };

  const resetSubjectiveTimerOrigin = () => {
    const snap = examTimerStore.getSnapshot();
    const nowSec =
      snap.attemptId === attempt.id ? snap.elapsedSeconds : attempt.elapsedSeconds;
    subjectiveBaseSecRef.current = nowSec;
    setSubjectiveBaseSec(nowSec);
  };

  const totalObjectiveCount = useMemo(() => {
    const count = allUnits
      .flatMap((u) => u.items)
      .filter(
        (it) =>
          it.answerMode === 'single-choice' ||
          it.answerMode === 'multi-choice'
      ).length;
    return count > 0 ? count : (exam.subject === '考研政治' ? 33 : 45);
  }, [allUnits, exam.subject]);

  const handleLocateEvidenceQuote = useCallback(
    (rawQuote: string) => {
      if (!rawQuote || !currentUnit) return;
      const normalize = (s: string) =>
        s
          .toLowerCase()
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/<u>|<\/u>/gi, '')
          .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const normQuote = normalize(rawQuote);
      if (!normQuote) return;
      const quoteWords = normQuote.split(' ').filter((w) => w.length >= 3);
      const quoteSnippets = [
        normQuote.slice(0, 48),
        normQuote.slice(0, 28),
        normQuote.slice(-36),
      ].filter((s) => s.length >= 8);

      let bestKey: string | null = null;
      let bestScore = -1;

      for (const mat of currentUnit.materials) {
        const paragraphs =
          mat.paragraphs && mat.paragraphs.length > 0
            ? mat.paragraphs
            : mat.text.split(/\n{2,}/).filter(Boolean);
        paragraphs.forEach((paraText, pIdx) => {
          const normPara = normalize(paraText);
          let score = 0;
          if (normPara.includes(normQuote)) {
            score += 1000;
          }
          for (const snip of quoteSnippets) {
            if (normPara.includes(snip)) {
              score += 200;
            }
          }
          for (const word of quoteWords) {
            if (normPara.includes(word)) {
              score += 10;
            }
          }
          if (score > bestScore && score > 0) {
            bestScore = score;
            bestKey = `${mat.id}-${pIdx}`;
          }
        });
      }

      if (!bestKey && currentUnit.materials[0]) {
        bestKey = `${currentUnit.materials[0].id}-0`;
      }
      if (!bestKey) return;

      setMobileReadingTab('article');
      setHighlightedParagraphKey(bestKey);
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      window.setTimeout(() => {
        document
          .getElementById(`passage-para-${bestKey}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedParagraphKey((prev) => (prev === bestKey ? null : prev));
      }, 2400);
    },
    [currentUnit]
  );

  const handleAskQuestionFollowUp = useCallback(
    async (qNum: number, questionText: string) => {
      const targetItem =
        currentUnit.items.find((it) => it.questionNumber === qNum) ||
        currentUnit.items[0];
      const resp = attempt.objectiveResponses[qNum];
      const existingAnalysis = objectiveAnalyses[`${exam.year}-q${qNum}`];
      const prevSummary = existingAnalysis
        ? `证据句：${existingAnalysis.evidenceQuote}；结论：${existingAnalysis.transferableConclusion}`
        : undefined;
      try {
        setAskingFollowUpQ(qNum);
        const reply = await onAskFollowUp({
          questionNumber: qNum,
          questionContext: `${currentUnit.title} #${qNum}`,
          unitId: currentUnit.id,
          unitTitle: currentUnit.title,
          passageText: currentUnit.materials.map((m) => m.text).join('\n\n'),
          promptText: targetItem
            ? `${targetItem.prompt}\n${(targetItem.options || [])
                .map((o) => `${o.key}. ${o.text}`)
                .join('\n')}`
            : currentUnit.instructions,
          userAnswer: resp?.selectedAnswer || '未作答',
          isSubmitted,
          userQuestion: questionText,
          previousAnalysisSummary: prevSummary,
        });
        const followUpKey = `${exam.year}:${qNum}`;
        setFollowUpHistory((prev) => ({
          ...prev,
          [followUpKey]: [...(prev[followUpKey] || []), { q: questionText, a: reply }],
        }));
      } catch (err: any) {
        setAiErrorBanner(err?.message || '追问请求失败');
      } finally {
        setAskingFollowUpQ(null);
      }
    },
    [
      attempt.objectiveResponses,
      currentUnit,
      exam.year,
      isSubmitted,
      objectiveAnalyses,
      onAskFollowUp,
    ]
  );

  const answeredObjectiveCount = Object.values(
    attempt.objectiveResponses
  ).filter((r) => Boolean(r.selectedAnswer)).length;

  const handleSelectOption = (questionNumber: number, optionKey: string, isMulti?: boolean) => {
    if (isSubmitted) return;
    const existing = attempt.objectiveResponses[questionNumber];
    if (isMulti) {
      const current = existing?.selectedAnswer || '';
      const set = new Set(current.split(''));
      if (set.has(optionKey)) {
        set.delete(optionKey);
      } else {
        set.add(optionKey);
      }
      const next = Array.from(set).sort().join('');
      onUpdateObjectiveResponse(questionNumber, {
        questionNumber,
        selectedAnswer: next,
        confidence: existing?.confidence || 'certain',
      });
    } else {
      onUpdateObjectiveResponse(questionNumber, {
        questionNumber,
        selectedAnswer: optionKey,
        confidence: existing?.confidence || 'certain',
      });
    }
  };

  const handleSelectConfidence = (
    questionNumber: number,
    confidence: ConfidenceLevel
  ) => {
    if (isSubmitted) return;
    onUpdateObjectiveResponse(questionNumber, {
      questionNumber,
      confidence,
    });
  };

  const handleToggleFlag = (questionNumber: number) => {
    const existing = attempt.objectiveResponses[questionNumber];
    onUpdateObjectiveResponse(questionNumber, {
      questionNumber,
      flaggedForReview: !existing?.flaggedForReview,
    });
  };

  const handleToggleKnownErrorCause = (
    questionNumber: number,
    cause: string
  ) => {
    const existing = attempt.objectiveResponses[questionNumber];
    const currentCauses = existing?.knownErrorCauses || [];
    const nextCauses = currentCauses.includes(cause)
      ? currentCauses.filter((c) => c !== cause)
      : [...currentCauses, cause];
    onUpdateObjectiveResponse(questionNumber, {
      questionNumber,
      knownErrorCauses: nextCauses,
    });
  };

  // Keyboard shortcuts for fast objective question navigation & answering
  const shortcutStateRef = useRef<{
    allUnits: ExamUnit[];
    currentUnit: ExamUnit;
    isPoliticsWorkspace: boolean;
    activeQuestionNumber: number;
    questionDisplayMode: 'single' | 'all';
    isSubmitted: boolean;
    hasOpenModal: boolean;
    handleSelectOption: (qNum: number, optKey: string, isMulti?: boolean) => void;
    handleSelectConfidence: (qNum: number, conf: ConfidenceLevel) => void;
    handleToggleFlag: (qNum: number) => void;
  } | null>(null);
  shortcutStateRef.current = {
    allUnits,
    currentUnit,
    isPoliticsWorkspace,
    activeQuestionNumber,
    questionDisplayMode,
    isSubmitted,
    hasOpenModal: showAnswerSheet || submitConfirmModal || showPrefsPopover,
    handleSelectOption,
    handleSelectConfidence,
    handleToggleFlag,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = shortcutStateRef.current;
      if (!state || state.hasOpenModal) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const uType = state.currentUnit.unitType;
      const isObjUnit =
        state.isPoliticsWorkspace ||
        uType === 'cloze' ||
        uType === 'reading';
      const items = state.isPoliticsWorkspace
        ? state.allUnits
            .filter(
              (u) =>
                u.unitType === 'politics-single' ||
                u.unitType === 'politics-multi'
            )
            .flatMap((u) => u.items)
        : state.currentUnit.items;
      if (!isObjUnit || items.length === 0) return;

      const activeIdx = Math.max(
        0,
        items.findIndex((i) => i.questionNumber === state.activeQuestionNumber)
      );
      const activeItem = items[activeIdx];
      if (!activeItem) return;

      const lower = e.key.toLowerCase();
      if (lower === 'j' || lower === 'k') {
        const nextIdx =
          lower === 'j'
            ? Math.min(items.length - 1, activeIdx + 1)
            : Math.max(0, activeIdx - 1);
        if (nextIdx !== activeIdx) {
          e.preventDefault();
          const nextQ = items[nextIdx].questionNumber;
          setActiveQuestionNumber(nextQ);
          if (
            state.questionDisplayMode === 'all' ||
            state.isPoliticsWorkspace
          ) {
            window.setTimeout(() => {
              document
                .getElementById(`question-card-${nextQ}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 20);
          }
        }
        return;
      }

      if (lower === 'f') {
        e.preventDefault();
        state.handleToggleFlag(activeItem.questionNumber);
        return;
      }

      if (state.isSubmitted) return;

      if (['a', 'b', 'c', 'd'].includes(lower)) {
        const optKey = lower.toUpperCase();
        if (activeItem.options?.some((o) => o.key === optKey)) {
          e.preventDefault();
          const isMulti =
            activeItem.answerMode === 'multi-choice' ||
            (!state.isPoliticsWorkspace && uType === 'politics-multi');
          state.handleSelectOption(activeItem.questionNumber, optKey, isMulti);
        }
        return;
      }

      if (lower === '1' || lower === '2' || lower === '3') {
        e.preventDefault();
        const confMap: Record<string, ConfidenceLevel> = {
          '1': 'certain',
          '2': 'hesitant',
          '3': 'guessed',
        };
        state.handleSelectConfidence(activeItem.questionNumber, confMap[lower]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleLocateUnfinished = () => {
    const searchItems = isPoliticsWorkspace
      ? allUnits
          .filter(
            (u) =>
              u.unitType === 'politics-single' || u.unitType === 'politics-multi'
          )
          .flatMap((u) => u.items)
      : currentUnit.items;
    const firstUnfinished = searchItems.find(
      (it) => !attempt.objectiveResponses[it.questionNumber]?.selectedAnswer
    );
    if (firstUnfinished) {
      setActiveQuestionNumber(firstUnfinished.questionNumber);
      const el = document.getElementById(
        `question-card-${firstUnfinished.questionNumber}`
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleCaptureSelectionHighlight = (materialId: string) => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel || sel.length < 3) return;
    setHighlightedQuotes((prev) => {
      const existing = prev[materialId] || [];
      if (existing.includes(sel)) return prev;
      return {
        ...prev,
        [materialId]: [...existing, sel.slice(0, 180)],
      };
    });
  };

  const handleAssignPartBCandidate = (slotNum: number, candidateId: string) => {
    if (isSubmitted || candidateId === 'E') return;
    for (let q = 41; q <= 45; q++) {
      if (
        q !== slotNum &&
        attempt.objectiveResponses[q]?.selectedAnswer === candidateId
      ) {
        onUpdateObjectiveResponse(q, {
          questionNumber: q,
          selectedAnswer: '',
        });
      }
    }
    onUpdateObjectiveResponse(slotNum, {
      questionNumber: slotNum,
      selectedAnswer: candidateId,
      confidence: attempt.objectiveResponses[slotNum]?.confidence || 'certain',
    });
  };

  const handleSaveSubjectiveVersion = async (autoTriggerAi: boolean) => {
    if (!currentUnit) return;
    setAiErrorBanner(null);

    if (currentUnit.unitType === 'translation') {
      const combined = [46, 47, 48, 49, 50]
        .map(
          (q) =>
            `(${q}) ${
              translationInputs[q]?.trim() || '【未填写该句译文】'
            }`
        )
        .join('\n');
      const created = onSubmitSubjectiveVersion({
        unitId: currentUnit.id,
        unitType: 'translation',
        questionNumber: 46,
        practiceMode,
        content: combined,
        subAnswers: { ...translationInputs },
        durationSeconds: getCurrentSubjectiveElapsed(),
        usedHints,
      });
      setSelectedVersionId(created.id);
      resetSubjectiveTimerOrigin();
      if (autoTriggerAi && anyModelAvailable) {
        try {
          setEvaluatingVersionId(created.id);
          await onRequestSubjectiveEvaluation(created, currentUnit);
        } catch (err: any) {
          setAiErrorBanner(err?.message || '主观题 AI 批改请求失败');
        } finally {
          setEvaluatingVersionId(null);
        }
      }
    } else if (
      currentUnit.unitType === 'practical-writing' ||
      currentUnit.unitType === 'visual-writing'
    ) {
      if (!writingDraft.trim()) {
        setAiErrorBanner('请先输入作文内容后再保存版本');
        return;
      }
      const qNum = currentUnit.items[0]?.questionNumber || 51;
      const created = onSubmitSubjectiveVersion({
        unitId: currentUnit.id,
        unitType: currentUnit.unitType,
        questionNumber: qNum,
        practiceMode,
        content: writingDraft,
        durationSeconds: getCurrentSubjectiveElapsed(),
        usedHints,
      });
      setSelectedVersionId(created.id);
      resetSubjectiveTimerOrigin();
      if (autoTriggerAi && anyModelAvailable) {
        try {
          setEvaluatingVersionId(created.id);
          await onRequestSubjectiveEvaluation(created, currentUnit);
        } catch (err: any) {
          setAiErrorBanner(err?.message || '主观题 AI 批改请求失败');
        } finally {
          setEvaluatingVersionId(null);
        }
      }
    }
  };

  const selectedVersion = useMemo(
    () => unitVersions.find((v) => v.id === selectedVersionId) || null,
    [unitVersions, selectedVersionId]
  );

  const compareBaseVersion = useMemo(
    () => unitVersions.find((v) => v.id === compareBaseVersionId) || null,
    [unitVersions, compareBaseVersionId]
  );

  const selectedEvaluation = useMemo(() => {
    if (!selectedVersion) return null;
    if (
      selectedVersion.evaluationId &&
      subjectiveEvaluations[selectedVersion.evaluationId]
    ) {
      return subjectiveEvaluations[selectedVersion.evaluationId];
    }
    return (
      Object.values(subjectiveEvaluations).find(
        (ev) => ev.answerVersionId === selectedVersion.id
      ) || null
    );
  }, [selectedVersion, subjectiveEvaluations]);

  const versionDiffResult = useMemo(() => {
    if (!selectedVersion || !compareBaseVersion) return null;
    return computeVersionDiff(
      compareBaseVersion.content,
      selectedVersion.content
    );
  }, [selectedVersion, compareBaseVersion]);

  const countEnglishWords = (text: string) =>
    text
      .trim()
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w)).length;

  const renderClozePassage = (text: string) => {
    const parts = text.split(/(\[\d{1,2}\])/g);
    return parts.map((part, idx) => {
      const m = part.match(/^\[(\d{1,2})\]$/);
      if (!m) {
        return <span key={idx}>{part}</span>;
      }
      const qNum = Number(m[1]);
      const resp = attempt.objectiveResponses[qNum];
      const item = currentUnit.items.find((i) => i.questionNumber === qNum);
      const selectedOpt = item?.options?.find(
        (o) => o.key === resp?.selectedAnswer
      );
      const isActive = activeQuestionNumber === qNum;
      const officialAns = item?.correctAnswer;
      const isCorrect =
        isSubmitted && officialAns && resp?.selectedAnswer === officialAns;
      const isWrong =
        isSubmitted && officialAns && resp?.selectedAnswer !== officialAns;

      return (
        <button
          key={idx}
          type="button"
          onClick={() => {
            setActiveQuestionNumber(qNum);
            const el = document.getElementById(`question-card-${qNum}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          className={`inline-flex items-center gap-1 mx-1 px-2 py-0.5 text-sm font-tabular-mono border transition-colors ${
            isCorrect
              ? 'bg-[#2E705B]/10 border-[#2E705B] text-[#2E705B] font-semibold'
              : isWrong
              ? 'bg-[#BA3B36]/10 border-[#BA3B36] text-[#BA3B36] font-semibold'
              : isActive
              ? 'bg-[#285E7A] text-white border-[#285E7A] font-semibold'
              : resp?.selectedAnswer
              ? 'bg-[#F4F7F8] border-[#285E7A] text-[#285E7A] font-medium'
              : 'bg-[#F4F7F8] border-[#D4DEE3] text-[#66747E]'
          }`}
        >
          <span>[{qNum}]</span>
          {selectedOpt && (
            <span className="font-english-serif underline">
              {selectedOpt.text}
            </span>
          )}
          {isSubmitted && isWrong && officialAns && (
            <span className="text-xs text-[#2E705B] ml-1">
              (正解:{officialAns})
            </span>
          )}
        </button>
      );
    });
  };

  const renderTextWithSafeUnderline = (rawText: string) => {
    const segments = rawText.split(/(<u>[\s\S]*?<\/u>)/gi);
    return segments.map((seg, i) => {
      const m = seg.match(/^<u>([\s\S]*?)<\/u>$/i);
      if (m) {
        return (
          <u
            key={i}
            className="decoration-[#285E7A] decoration-2 underline-offset-4 font-semibold bg-[#285E7A]/5 px-1"
          >
            {m[1]}
          </u>
        );
      }
      return <span key={i}>{seg}</span>;
    });
  };

  const partBSpec = currentUnit.materials.find(
    (m) => m.passageAssemblySpec
  )?.passageAssemblySpec;
  const practicalSpec = currentUnit.materials.find(
    (m) => m.practicalWritingSpec
  )?.practicalWritingSpec;
  const visualMats =
    currentUnit.materials.find(
      (m) => m.visualMaterials && m.visualMaterials.length > 0
    )?.visualMaterials || [];
  const visualMat = visualMats[0];

  const getCompactUnitPillLabel = (u: ExamUnit): string => {
    const firstQ = u.items[0]?.questionNumber;
    const lastQ = u.items[u.items.length - 1]?.questionNumber;
    const range =
      firstQ && lastQ
        ? firstQ === lastQ
          ? `${firstQ}`
          : `${firstQ}-${lastQ}`
        : '';
    if (u.unitType === 'politics-single') return `单选 ${range}`;
    if (u.unitType === 'politics-multi') return `多选 ${range}`;
    if (u.unitType === 'politics-analysis') return `分析 ${range}`;
    if (u.unitType === 'cloze') return `完形 ${range}`;
    if (u.unitType === 'reading') {
      const m = u.title.match(/Text\s*\d+/i);
      return m ? `${m[0]} ${range}` : `阅读 ${range}`;
    }
    if (u.unitType === 'passage-assembly') return `新题型 ${range}`;
    if (u.unitType === 'translation') return `翻译 ${range}`;
    if (u.unitType === 'practical-writing') return `小作文 ${range}`;
    if (u.unitType === 'visual-writing') return `大作文 ${range}`;
    return `${u.title} ${range}`;
  };

  return (
    <div className={isCompactReview ? 'space-y-3' : 'space-y-4'}>
      {/* Top Workspace Control Bar */}
      <header
        className={`bg-white/95 dark:bg-[#1C262B]/95 backdrop-blur-xs rounded-xl border border-stone-200/90 dark:border-[#2C3E46] shadow-xs flex flex-col gap-2 sticky top-14 z-20 transition-all ${
          isCompactReview ? 'p-2 sm:p-3' : 'p-2.5 sm:p-4'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onExitWorkspace}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>退出</span>
            </button>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-xs sm:text-sm font-bold text-stone-900 dark:text-[#E2E8E6]">
                {formatExamTitle(exam.year, exam.subject)}
              </span>
              <span className="text-xs text-stone-400 dark:text-[#657980]">·</span>
              <span className="text-xs text-stone-600 dark:text-[#9CAEB3] font-medium">
                {attempt.mode === 'strict-simulation'
                  ? '整卷严格模拟'
                  : attempt.mode === 'free-simulation'
                  ? '整卷自由模拟'
                  : '专项练习'}
              </span>
              {exam.answerSourceStatus === 'unavailable' && (
                <span className="text-xs text-amber-700 dark:text-[#E5B55E] bg-amber-50 dark:bg-[#2E2413] px-2 py-0.5 rounded font-medium">
                  该年暂无官方答案，不计客观题总分
                </span>
              )}
              {isSubmitted && (
                <span className="text-xs text-emerald-800 dark:text-[#4EA387] bg-emerald-50 dark:bg-[#172E27] px-2 py-0.5 rounded font-semibold font-tabular-mono">
                  {exam.answerSourceStatus === 'unavailable'
                    ? '已保存作答 · 复盘模式'
                    : `已交卷 · 客观题 ${attempt.totalObjectiveScore ?? 0} / ${
                        attempt.maxObjectiveScore ?? 60
                      } 分`}
                </span>
              )}
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {!isSubmitted && (
              <WorkspaceTimerControls
                mode={attempt.mode}
                durationMinutes={exam.durationMinutes}
                isSubmitted={isSubmitted}
                isStrictSimulation={isStrictSimulation}
                isPaused={isPaused}
                onTogglePause={() => {
                  setIsPaused((p) => {
                    const next = !p;
                    examTimerStore.setPaused(next);
                    return next;
                  });
                }}
              />
            )}

            {isSubmitted && (
              <>
                <div
                  className="inline-flex items-center p-0.5 rounded-lg bg-stone-100 dark:bg-[#162226] border border-stone-200 dark:border-[#2C3E46] text-[11px]"
                  role="group"
                  aria-label="复盘排版密度"
                >
                  {(
                    [
                      { id: 'compact', label: '紧凑复盘' },
                      { id: 'comfortable', label: '舒适视图' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setReviewDensity(opt.id)}
                      className={`px-2 py-1 rounded-md font-medium transition-colors ${
                        reviewDensity === opt.id
                          ? 'bg-white dark:bg-[#1E2B30] text-[#174A5B] dark:text-[#75B6CE] shadow-2xs'
                          : 'text-[#68777C] dark:text-[#9CAEB3]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div
                  className="inline-flex items-center p-0.5 rounded-lg bg-stone-100 dark:bg-[#162226] border border-stone-200 dark:border-[#2C3E46] text-[11px]"
                  role="group"
                  aria-label="复盘题目筛选"
                >
                  {(
                    [
                      { id: 'all', label: '全部' },
                      { id: 'wrong', label: '仅错题' },
                      { id: 'flagged', label: '已标疑' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setReviewFilter(f.id)}
                      className={`px-2 py-1 rounded-md font-medium transition-colors ${
                        reviewFilter === f.id
                          ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                          : 'text-[#68777C] dark:text-[#9CAEB3]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {!isSubmitted && (
              <span className="text-[11px] text-stone-400 dark:text-[#657980] font-tabular-mono hidden md:inline">
                已自动保存
              </span>
            )}

            {/* Typography Settings Trigger (English texts) */}
            {!isPoliticsWorkspace && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPrefsPopover((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:text-[#E2E8E6] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] rounded-lg whitespace-nowrap"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>排版 ({typographyPrefs.fontSizePx}px)</span>
                </button>
                {showPrefsPopover && (
                  <div className="absolute right-0 mt-1 w-64 bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46] p-4 shadow-md z-30 space-y-3 text-xs rounded-xl">
                    <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6] flex items-center justify-between border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-1.5">
                      <span>英语文章排版控制</span>
                      <button
                        type="button"
                        aria-label="关闭排版设置"
                        onClick={() => setShowPrefsPopover(false)}
                      >
                        <X className="w-3.5 h-3.5 text-[#68777C] dark:text-[#9CAEB3]" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[#68777C] dark:text-[#9CAEB3]">
                        <span>字号 (默认 18px)</span>
                        <span className="font-tabular-mono text-[#202B2F] dark:text-[#E2E8E6]">
                          {typographyPrefs.fontSizePx}px
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        {[16, 18, 20, 22].map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() =>
                              onUpdateTypographyPrefs({
                                ...typographyPrefs,
                                fontSizePx: sz,
                              })
                            }
                            className={`flex-1 py-1 rounded text-xs border font-tabular-mono transition-colors ${
                              typographyPrefs.fontSizePx === sz
                                ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E]'
                                : 'bg-[#F1F5F3] dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border-[#DCE4E1] dark:border-[#2C3E46]'
                            }`}
                          >
                            {sz}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[#68777C] dark:text-[#9CAEB3]">
                        <span>行高 (默认 1.8)</span>
                        <span className="font-tabular-mono text-[#202B2F] dark:text-[#E2E8E6]">
                          {typographyPrefs.lineHeight}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1.6, 1.8, 2.0].map((lh) => (
                          <button
                            key={lh}
                            type="button"
                            onClick={() =>
                              onUpdateTypographyPrefs({
                                ...typographyPrefs,
                                lineHeight: lh,
                              })
                            }
                            className={`flex-1 py-1 rounded text-xs border font-tabular-mono transition-colors ${
                              typographyPrefs.lineHeight === lh
                                ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E]'
                                : 'bg-[#F1F5F3] dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border-[#DCE4E1] dark:border-[#2C3E46]'
                            }`}
                          >
                            {lh}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowAnswerSheet(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:text-[#E2E8E6] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] rounded-lg font-tabular-mono whitespace-nowrap transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
              <span>答题卡 ({answeredObjectiveCount}/{totalObjectiveCount})</span>
            </button>

            {isSubmitted && onRestartFreshPaper && (
              <button
                type="button"
                onClick={onRestartFreshPaper}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#174A5B] dark:text-[#75B6CE] bg-[#E8F1F5] dark:bg-[#1D3642] hover:bg-[#D5E5ED] dark:hover:bg-[#254657] border border-[#B6D1DC] dark:border-[#2E5263] rounded-lg transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>再刷一遍</span>
              </button>
            )}

            {!isSubmitted && onOpenQuickChecker && (
              <button
                type="button"
                onClick={onOpenQuickChecker}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#174A5B] dark:text-[#38849E] bg-[#E8F1F5] dark:bg-[#1D3642] hover:bg-[#D5E5ED] dark:hover:bg-[#254657] border border-[#B6D1DC] dark:border-[#2E5263] rounded-lg transition-colors whitespace-nowrap shadow-2xs"
                title="纸上已做完？点击快速批量输入/粘贴答案并立即核对判分"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>纸卷极速对答案</span>
              </button>
            )}

            {!isSubmitted && (
              <button
                type="button"
                onClick={() => setSubmitConfirmModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-lg shadow-xs whitespace-nowrap transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>交卷核对</span>
              </button>
            )}
          </div>
        </div>

        {/* Horizontal Direct Section / Unit Jump Bar (replaces dropdown select) */}
        <nav
          aria-label="试卷题区直达跳转"
          className="flex items-center gap-1.5 overflow-x-auto pt-1.5 border-t border-stone-100 dark:border-[#26373E]"
        >
          <span className="text-[11px] font-medium text-stone-400 dark:text-[#657980] whitespace-nowrap shrink-0 mr-1">
            {isPoliticsWorkspace ? '同卷分区跳转：' : '切换题区：'}
          </span>
          {allUnits.map((u) => {
            const isActiveUnit = u.id === currentUnit?.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onSelectUnit(u.id);
                  if (isPoliticsWorkspace) {
                    if (reviewFilter !== 'all') setReviewFilter('all');
                    window.setTimeout(() => {
                      document
                        .getElementById(`unit-section-${u.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 30);
                  }
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors font-tabular-mono ${
                  isActiveUnit
                    ? 'bg-[#174A5B] dark:bg-[#38849E] text-white shadow-2xs'
                    : 'bg-stone-100 dark:bg-[#162226] text-stone-700 dark:text-[#9CAEB3] hover:bg-stone-200 dark:hover:bg-[#203036]'
                }`}
              >
                {getCompactUnitPillLabel(u)}
              </button>
            );
          })}
        </nav>
      </header>

      {aiErrorBanner && (
        <div
          role="alert"
          className="bg-white dark:bg-[#1E2B30] border border-[#A8544A] dark:border-[#CF695E] p-3 text-xs text-[#A8544A] dark:text-[#CF695E] flex items-center justify-between rounded-lg"
        >
          <span>{aiErrorBanner}</span>
          <button
            type="button"
            onClick={() => setAiErrorBanner(null)}
            className="text-[#202B2F] dark:text-[#E2E8E6] underline ml-4"
          >
            关闭
          </button>
        </div>
      )}

      {/* UNIT TYPE: POLITICS UNIFIED FULL PAPER (1–16 单选 + 17–33 多选 + 34–38 材料分析) */}
      {isPoliticsWorkspace && (
        <div className={isCompactReview ? 'space-y-3' : 'space-y-5'}>
          {/* Compact Top Exam Summary Strip */}
          {(!isSubmitted || reviewDensity === 'comfortable') && (
            <div
              className={`bg-white dark:bg-[#1E2B30] rounded-2xl border border-stone-200/80 dark:border-[#2C3E46] shadow-xs flex flex-wrap items-center justify-between gap-3 ${
                isSubmitted ? 'p-3.5 sm:p-4' : 'p-4 sm:p-5'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#75B6CE]">
                    全卷整页作答与复盘
                  </span>
                  <h1 className="text-sm sm:text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                    {formatExamTitle(exam.year, exam.subject)} · 完整试卷 (第 1–38 题)
                  </h1>
                </div>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                  单选 (1–16)、多选 (17–33) 与材料分析 (34–38) 同卷顺排，点击右侧或顶部题区按钮即可瞬时跳转。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <span className="hidden xl:inline text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                  快捷键：J/K 切题 · A-D 作答 · 1-3 把握度 · F 标疑
                </span>
                {!isSubmitted && (
                  <button
                    type="button"
                    onClick={handleLocateUnfinished}
                    className="px-3 py-1.5 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] bg-[#174A5B]/10 dark:bg-[#38849E]/20 hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white rounded-lg transition-colors"
                  >
                    定位未做题
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Continuous Full-Paper Grid with Truly Fixed Right Navigator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left/Main Column: All Sections Sequential Feed (1-16, 17-33, 34-38) */}
            <div className={`lg:col-span-9 xl:col-span-9 ${isCompactReview ? 'space-y-4' : 'space-y-6'}`}>
              {allUnits.map((sectionUnit) => {
                if (
                  sectionUnit.unitType === 'politics-single' ||
                  sectionUnit.unitType === 'politics-multi'
                ) {
                  const isMultiUnit = sectionUnit.unitType === 'politics-multi';
                  const filteredItems = sectionUnit.items.filter((item) => {
                    if (!isSubmitted || reviewFilter === 'all') return true;
                    const r = attempt.objectiveResponses[item.questionNumber];
                    if (reviewFilter === 'flagged') return Boolean(r?.flaggedForReview);
                    if (reviewFilter === 'wrong') {
                      return Boolean(item.correctAnswer) && r?.selectedAnswer !== item.correctAnswer;
                    }
                    return true;
                  });

                  return (
                    <section
                      key={sectionUnit.id}
                      id={`unit-section-${sectionUnit.id}`}
                      className={`scroll-mt-36 ${isCompactReview ? 'space-y-2.5' : 'space-y-4'}`}
                    >
                      <div
                        className={`bg-white dark:bg-[#1E2B30] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] flex flex-wrap items-center justify-between gap-2 ${
                          isCompactReview ? 'px-4 py-2.5' : 'px-5 py-3.5'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#75B6CE]">
                            {isMultiUnit ? '多项选择题' : '单项选择题'}
                          </span>
                          <h2 className="text-sm sm:text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                            {sectionUnit.title}
                          </h2>
                        </div>
                        <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                          满分 {sectionUnit.score} 分 · 共 {sectionUnit.items.length} 题
                        </span>
                      </div>

                      {filteredItems.length === 0 ? (
                        <div className="p-4 rounded-xl bg-stone-50 dark:bg-[#162226] border border-stone-200/80 dark:border-[#2C3E46] text-xs text-[#68777C] dark:text-[#9CAEB3] flex items-center justify-between">
                          <span>本部分暂无符合「{reviewFilter === 'wrong' ? '仅错题' : '已标疑'}」条件的题目。</span>
                          <button
                            type="button"
                            onClick={() => setReviewFilter('all')}
                            className="text-[#174A5B] dark:text-[#75B6CE] font-medium hover:underline"
                          >
                            显示全部题目
                          </button>
                        </div>
                      ) : (
                        filteredItems.map((item) => {
                          const qNum = item.questionNumber;
                          const isMulti = isMultiUnit || item.answerMode === 'multi-choice';
                          const resp = attempt.objectiveResponses[qNum];
                          const selectedAns = resp?.selectedAnswer || '';
                          const confidence = resp?.confidence || 'certain';
                          const officialAns = item.correctAnswer || '';
                          const isCorrect =
                            isSubmitted && Boolean(officialAns) && selectedAns === officialAns;
                          const isWrong =
                            isSubmitted && Boolean(officialAns) && selectedAns !== officialAns;
                          const isCurrent = activeQuestionNumber === qNum;

                          const missedLetters =
                            isMulti && isSubmitted
                              ? officialAns.split('').filter((c) => !selectedAns.includes(c))
                              : [];
                          const wrongLetters =
                            isMulti && isSubmitted
                              ? selectedAns.split('').filter((c) => !officialAns.includes(c))
                              : [];

                          return (
                            <div
                              key={item.id}
                              id={`question-card-${qNum}`}
                              onClick={() => setActiveQuestionNumber(qNum)}
                              className={`bg-white dark:bg-[#1E2B30] rounded-2xl border transition-all shadow-xs ${
                                isCompactReview
                                  ? 'p-3.5 sm:p-4 space-y-2.5'
                                  : 'p-5 sm:p-7 space-y-4'
                              } ${
                                isCurrent
                                  ? 'border-[#174A5B] dark:border-[#38849E] ring-1 ring-[#174A5B]/20 dark:ring-[#38849E]/30'
                                  : isCorrect
                                  ? 'border-emerald-200 dark:border-emerald-800/60'
                                  : isWrong
                                  ? 'border-rose-200 dark:border-rose-900/60'
                                  : 'border-stone-200/80 dark:border-[#2C3E46]'
                              }`}
                            >
                              {/* Card Header */}
                              <div
                                className={`flex items-start justify-between gap-2 border-b border-stone-100 dark:border-[#26373E] ${
                                  isCompactReview ? 'pb-2' : 'pb-3'
                                }`}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`font-tabular-mono font-bold text-[#174A5B] dark:text-[#75B6CE] ${
                                      isCompactReview ? 'text-sm sm:text-base' : 'text-base sm:text-lg'
                                    }`}
                                  >
                                    第 {qNum} 题
                                  </span>
                                  {item.knowledgeModule && (
                                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 dark:bg-[#162226] text-stone-700 dark:text-[#9CAEB3] border border-stone-200/80 dark:border-[#2C3E46]">
                                      {item.knowledgeModule}
                                    </span>
                                  )}
                                  <span className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3]">
                                    ({item.score}分 · {isMulti ? '多选题' : '单选题'})
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    aria-label={`标记第${qNum}题待复查`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleFlag(qNum);
                                    }}
                                    className={`p-1.5 rounded-lg border transition-colors ${
                                      resp?.flaggedForReview
                                        ? 'bg-rose-50 dark:bg-[#351C1A] border-rose-300 dark:border-rose-800 text-rose-700 dark:text-[#CF695E]'
                                        : 'bg-stone-50 dark:bg-[#162226] border-stone-200 dark:border-[#2C3E46] text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
                                    }`}
                                  >
                                    <Flag className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Question Prompt */}
                              <div
                                className={`font-medium text-[#202B2F] dark:text-[#E2E8E6] ${
                                  isCompactReview
                                    ? 'text-sm sm:text-[15px] leading-snug'
                                    : 'text-base sm:text-[17px] leading-relaxed'
                                }`}
                              >
                                {renderTextWithSafeUnderline(item.prompt)}
                              </div>

                              {/* Options List */}
                              <div className={isCompactReview ? 'grid grid-cols-1 gap-1.5' : 'grid grid-cols-1 gap-2.5'}>
                                {(item.options || []).map((opt) => {
                                  const isSelected = isMulti
                                    ? selectedAns.includes(opt.key)
                                    : selectedAns === opt.key;
                                  const isOfficialRight =
                                    isSubmitted &&
                                    (isMulti
                                      ? officialAns.includes(opt.key)
                                      : officialAns === opt.key);
                                  const isSelectedMistake =
                                    isSubmitted &&
                                    isSelected &&
                                    !(isMulti
                                      ? officialAns.includes(opt.key)
                                      : officialAns === opt.key);

                                  const badgeStyle = isOfficialRight
                                    ? 'bg-emerald-600 text-white'
                                    : isSelectedMistake
                                    ? 'bg-rose-600 text-white'
                                    : isSelected && !isSubmitted
                                    ? 'bg-white/20 text-white'
                                    : 'bg-stone-200/70 dark:bg-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6]';

                                  return (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      disabled={isSubmitted}
                                      onClick={() => handleSelectOption(qNum, opt.key, isMulti)}
                                      className={`w-full text-left rounded-xl border flex items-start gap-2.5 transition-all ${
                                        isCompactReview
                                          ? 'px-3 py-2 text-xs sm:text-sm min-h-[38px]'
                                          : 'px-4 py-3 sm:py-3.5 text-sm sm:text-base min-h-[48px]'
                                      } ${
                                        isOfficialRight
                                          ? 'bg-emerald-50 dark:bg-[#172E27] border-emerald-500 dark:border-[#4EA387] text-[#202B2F] dark:text-[#E2E8E6] font-medium'
                                          : isSelectedMistake
                                          ? 'bg-rose-50 dark:bg-[#351C1A] border-rose-400 dark:border-[#CF695E] text-[#202B2F] dark:text-[#E2E8E6]'
                                          : isSelected
                                          ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E] shadow-2xs'
                                          : 'bg-stone-50/70 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border-stone-200/90 dark:border-[#2C3E46] hover:bg-stone-100 dark:hover:bg-[#203036] hover:border-stone-300 dark:hover:border-[#3B515B]'
                                      }`}
                                    >
                                      <span
                                        className={`font-tabular-mono font-bold shrink-0 px-2 py-0.5 rounded flex items-center justify-center ${
                                          isCompactReview ? 'text-xs min-w-[24px]' : 'text-xs sm:text-sm min-w-[28px]'
                                        } ${badgeStyle}`}
                                      >
                                        {opt.key}
                                      </span>
                                      <span className="leading-snug pt-0.5 flex-1">
                                        {opt.text}
                                      </span>
                                      {/* Post-submit attribution pill OR pre-submit checkbox/radio */}
                                      {isSubmitted && (isOfficialRight || isSelectedMistake) ? (
                                        <span
                                          className={`shrink-0 self-center text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
                                            isOfficialRight
                                              ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-[#7CE0BE]'
                                              : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-[#F39990]'
                                          }`}
                                        >
                                          {isOfficialRight && isSelected
                                            ? '✓ 选对'
                                            : isOfficialRight
                                            ? isMulti
                                              ? '+ 漏选'
                                              : '+ 应选'
                                            : '✕ 错选'}
                                        </span>
                                      ) : (
                                        <span className="shrink-0 pt-1 text-xs opacity-75">
                                          {isMulti ? (
                                            isSelected ? (
                                              <CheckSquare className="w-4 h-4 text-white" />
                                            ) : (
                                              <Square className="w-4 h-4 text-stone-400" />
                                            )
                                          ) : isSelected ? (
                                            <span className="w-3.5 h-3.5 rounded-full bg-white block" />
                                          ) : (
                                            <span className="w-3.5 h-3.5 rounded-full border border-stone-400 block" />
                                          )}
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Pre-submit: Multi-choice Selection summary & Confidence */}
                              {!isSubmitted && (
                                <div className="pt-3 border-t border-stone-100 dark:border-[#26373E] flex flex-wrap items-center justify-between gap-3 text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[#68777C] dark:text-[#9CAEB3]">
                                      {isMulti ? '多选作答状态：' : '单选作答状态：'}
                                    </span>
                                    <span
                                      className={`font-tabular-mono font-bold px-2 py-0.5 rounded ${
                                        selectedAns
                                          ? 'bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#75B6CE]'
                                          : 'bg-stone-100 dark:bg-[#162226] text-stone-400'
                                      }`}
                                    >
                                      {selectedAns
                                        ? `已选 [ ${selectedAns.split('').join(' ')} ]`
                                        : '尚未选定'}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[#68777C] dark:text-[#9CAEB3] mr-1">
                                      做题把握：
                                    </span>
                                    {(
                                      [
                                        { key: 'certain', label: '确定' },
                                        { key: 'hesitant', label: '犹豫' },
                                        { key: 'guessed', label: '猜测' },
                                      ] as { key: ConfidenceLevel; label: string }[]
                                    ).map((c) => (
                                      <button
                                        key={c.key}
                                        type="button"
                                        onClick={() => handleSelectConfidence(qNum, c.key)}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                          confidence === c.key
                                            ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                                            : 'bg-stone-100 dark:bg-[#162226] text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
                                        }`}
                                      >
                                        {c.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Post-submit: Correctness Banner, Official Explanation & Review Notes */}
                              {isSubmitted && (
                                <div
                                  className={`border-t border-stone-100 dark:border-[#26373E] ${
                                    isCompactReview ? 'space-y-2.5 pt-2' : 'space-y-3.5 pt-3'
                                  }`}
                                >
                                  <div
                                    className={`rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                                      isCompactReview ? 'px-3 py-2 text-xs' : 'p-4 text-sm'
                                    } ${
                                      isCorrect
                                        ? 'bg-emerald-50/70 dark:bg-[#172E27]/70 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-[#4EA387]'
                                        : 'bg-rose-50/70 dark:bg-[#351C1A]/70 border-rose-300 dark:border-rose-900 text-rose-900 dark:text-[#CF695E]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={isCompactReview ? 'font-bold text-xs sm:text-sm' : 'font-bold text-base'}>
                                        {isCorrect ? '✓ 作答正确' : '✕ 作答错误'}
                                      </span>
                                      <span className="font-tabular-mono font-semibold">
                                        ({isCorrect ? `+${item.score}分` : '0分'})
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-3 font-tabular-mono text-xs">
                                      <span>
                                        你的答案：
                                        <strong className="underline ml-0.5">
                                          {selectedAns || '未答'}
                                        </strong>
                                      </span>
                                      <span>·</span>
                                      <span>
                                        官方标准答案：
                                        <strong className="underline ml-0.5">
                                          {officialAns}
                                        </strong>
                                      </span>
                                    </div>

                                    {isWrong && isMulti && (
                                      <div className="w-full text-xs text-rose-700 dark:text-[#E07A70] flex flex-wrap items-center gap-2 pt-1 border-t border-rose-200/60 dark:border-rose-900/40">
                                        <span>失分诊断：</span>
                                        {missedLetters.length > 0 && (
                                          <span className="bg-rose-100/80 dark:bg-rose-900/40 px-2 py-0.5 rounded">
                                            漏选 {missedLetters.join('、')}
                                          </span>
                                        )}
                                        {wrongLetters.length > 0 && (
                                          <span className="bg-rose-100/80 dark:bg-rose-900/40 px-2 py-0.5 rounded">
                                            误选干扰项 {wrongLetters.join('、')}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {item.officialExplanation && (
                                    <div
                                      className={`bg-stone-50 dark:bg-[#162226] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] ${
                                        isCompactReview ? 'p-3 space-y-1.5' : 'p-4 sm:p-5 space-y-2'
                                      }`}
                                    >
                                      <div className="font-bold text-xs text-[#174A5B] dark:text-[#75B6CE] flex items-center justify-between border-b border-stone-200/70 dark:border-[#26373E] pb-1.5">
                                        <span>【肖秀荣答案与逐题详尽解析】</span>
                                        <span className="font-tabular-mono text-[11px] text-stone-400">
                                          权威精析 · 知识点关联
                                        </span>
                                      </div>
                                      <div
                                        className={`text-[#202B2F] dark:text-[#E2E8E6] whitespace-pre-wrap font-sans pt-0.5 ${
                                          isCompactReview ? 'text-xs leading-relaxed' : 'text-xs sm:text-sm leading-relaxed'
                                        }`}
                                      >
                                        {item.officialExplanation}
                                      </div>
                                    </div>
                                  )}

                                  {/* Editable Post-Submit Notes */}
                                  <div className="space-y-1">
                                    <label className="block text-[11px] font-medium text-[#68777C] dark:text-[#9CAEB3]">
                                      我的复盘笔记：
                                    </label>
                                    <textarea
                                      rows={isCompactReview ? 1 : 2}
                                      value={resp?.userNotes || ''}
                                      onChange={(e) =>
                                        onUpdateObjectiveResponse(qNum, {
                                          questionNumber: qNum,
                                          userNotes: e.target.value,
                                        })
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                      placeholder="随时记录本题核心考点、干扰项陷阱..."
                                      className="w-full px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] rounded-lg border border-stone-200/80 dark:border-[#2C3E46] focus:outline-none focus:border-[#174A5B] dark:focus:border-[#38849E] resize-y"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </section>
                  );
                }

                if (sectionUnit.unitType === 'politics-analysis') {
                  return (
                    <section
                      key={sectionUnit.id}
                      id={`unit-section-${sectionUnit.id}`}
                      className="scroll-mt-36 space-y-4"
                    >
                      <div
                        className={`bg-white dark:bg-[#1E2B30] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] flex flex-wrap items-center justify-between gap-2 ${
                          isCompactReview ? 'px-4 py-2.5' : 'px-5 py-3.5'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#75B6CE]">
                            材料分析题
                          </span>
                          <h2 className="text-sm sm:text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                            {sectionUnit.title}
                          </h2>
                        </div>
                        <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                          共 {sectionUnit.items.length} 题 · 满分 {sectionUnit.score} 分
                        </span>
                      </div>

                      {isSubmitted && reviewFilter === 'wrong' ? (
                        <div className="p-4 rounded-xl bg-stone-50 dark:bg-[#162226] border border-stone-200/80 dark:border-[#2C3E46] text-xs text-[#68777C] dark:text-[#9CAEB3] flex flex-wrap items-center justify-between gap-2">
                          <span>当前处于「仅错题」筛选视图，34–38 材料分析题已折叠。</span>
                          <button
                            type="button"
                            onClick={() => setReviewFilter('all')}
                            className="text-[#174A5B] dark:text-[#75B6CE] font-medium hover:underline"
                          >
                            展开全部题型（含材料分析）
                          </button>
                        </div>
                      ) : (
                        <PoliticsAnalysisStudio
                          key={`${exam.year}-${sectionUnit.id}`}
                          year={exam.year}
                          dataVersion={exam.dataVersion}
                          currentUnit={sectionUnit}
                          isSubmitted={isSubmitted}
                          isStrictSimulation={isStrictSimulation}
                          showAnswerSheet={showAnswerSheet}
                          anyModelAvailable={anyModelAvailable}
                          activeProviderName={activeProviderName}
                          unitVersions={subjectiveVersions.filter(
                            (v) => v.unitId === sectionUnit.id
                          )}
                          subjectiveEvaluations={subjectiveEvaluations}
                          drafts={translationInputs}
                          onChangeDraft={(qNum, value) =>
                            setTranslationInputs((prev) => ({ ...prev, [qNum]: value }))
                          }
                          getElapsedSeconds={getCurrentSubjectiveElapsed}
                          onSubmitSubjectiveVersion={(params) => {
                            const created = onSubmitSubjectiveVersion(params);
                            resetSubjectiveTimerOrigin();
                            return created;
                          }}
                          onRequestSubjectiveEvaluation={onRequestSubjectiveEvaluation}
                          onNavigateSettings={onNavigateSettings}
                        />
                      )}
                    </section>
                  );
                }

                return null;
              })}
            </div>

            {/* Right Viewport-Pinned Full-Paper Navigator Pane (Desktop) */}
            <aside className="lg:col-span-3 xl:col-span-3 lg:sticky lg:top-40 lg:max-h-[calc(100dvh-10.5rem)] lg:overflow-y-auto space-y-3">
              <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-stone-200/80 dark:border-[#2C3E46] p-4 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-stone-100 dark:border-[#26373E] pb-2.5">
                  <h3 className="text-xs font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                    全卷题号快速跳转
                  </h3>
                  <span className="text-xs font-tabular-mono text-[#174A5B] dark:text-[#75B6CE] font-semibold">
                    客观 {answeredObjectiveCount}/{totalObjectiveCount}
                  </span>
                </div>

                {allUnits.map((navUnit) => {
                  const isAnalysisUnit = navUnit.unitType === 'politics-analysis';
                  return (
                    <div key={navUnit.id} className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectUnit(navUnit.id);
                          if (isAnalysisUnit && reviewFilter !== 'all') {
                            setReviewFilter('all');
                          }
                          window.setTimeout(() => {
                            document
                              .getElementById(`unit-section-${navUnit.id}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }, 30);
                        }}
                        className="w-full flex items-center justify-between text-[11px] font-semibold text-[#68777C] dark:text-[#9CAEB3] hover:text-[#174A5B] dark:hover:text-[#75B6CE] transition-colors"
                      >
                        <span>{getCompactUnitPillLabel(navUnit)}</span>
                        <span className="font-tabular-mono opacity-75">
                          {navUnit.items.length}题
                        </span>
                      </button>

                      <div className={isAnalysisUnit ? 'grid grid-cols-5 gap-1.5' : 'grid grid-cols-4 gap-1.5'}>
                        {navUnit.items.map((it) => {
                          const qN = it.questionNumber;
                          const resp = attempt.objectiveResponses[qN];
                          const hasSubj =
                            isAnalysisUnit &&
                            subjectiveVersions.some(
                              (v) => v.year === exam.year && v.questionNumber === qN
                            );
                          const isCur = qN === activeQuestionNumber;
                          const hasAnswer = Boolean(resp?.selectedAnswer) || hasSubj;
                          const isRight =
                            isSubmitted &&
                            !isAnalysisUnit &&
                            Boolean(it.correctAnswer) &&
                            resp?.selectedAnswer === it.correctAnswer;
                          const isFault =
                            isSubmitted &&
                            !isAnalysisUnit &&
                            Boolean(it.correctAnswer) &&
                            resp?.selectedAnswer !== it.correctAnswer;

                          return (
                            <button
                              key={qN}
                              type="button"
                              onClick={() => {
                                onSelectUnit(navUnit.id);
                                setActiveQuestionNumber(qN);
                                if (reviewFilter !== 'all') {
                                  setReviewFilter('all');
                                }
                                window.setTimeout(() => {
                                  document
                                    .getElementById(`question-card-${qN}`)
                                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 40);
                              }}
                              className={`h-8 rounded-md font-tabular-mono text-xs font-bold transition-all flex items-center justify-center relative ${
                                isCur
                                  ? 'ring-2 ring-[#174A5B] dark:ring-[#38849E] scale-[1.03] shadow-2xs '
                                  : ''
                              } ${
                                isRight
                                  ? 'bg-emerald-50 dark:bg-[#172E27] text-emerald-800 dark:text-[#4EA387] border border-emerald-400 dark:border-emerald-700'
                                  : isFault
                                  ? 'bg-rose-50 dark:bg-[#351C1A] text-rose-800 dark:text-[#CF695E] border border-rose-400 dark:border-rose-900'
                                  : hasAnswer
                                  ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                                  : 'bg-stone-50 dark:bg-[#162226] text-stone-600 dark:text-[#9CAEB3] border border-stone-200 dark:border-[#2C3E46] hover:bg-stone-100 dark:hover:bg-[#203036]'
                              }`}
                            >
                              <span>{qN}</span>
                              {resp?.flaggedForReview && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute top-0.5 right-0.5" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {!isSubmitted && (
                  <div className="pt-2 border-t border-stone-100 dark:border-[#26373E]">
                    <button
                      type="button"
                      onClick={handleLocateUnfinished}
                      className="w-full py-2 px-3 rounded-lg text-xs font-semibold text-center text-[#174A5B] dark:text-[#75B6CE] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] transition-colors"
                    >
                      跳转到首个未做题
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Mobile Fixed Quick Jump Pill */}
          <button
            type="button"
            onClick={() => setShowAnswerSheet(true)}
            className="lg:hidden fixed bottom-4 right-4 z-30 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-[#174A5B] dark:bg-[#38849E] text-white text-xs font-semibold shadow-lg"
          >
            <Layers className="w-4 h-4" />
            <span>题号跳转</span>
          </button>
        </div>
      )}

      {/* UNIT TYPE 1 & 2: CLOZE (1-20) & READING PART A (21-40) */}
      {(currentUnit.unitType === 'cloze' ||
        currentUnit.unitType === 'reading') && (
        <div className="space-y-3">
          {/* Mobile Viewport Segmented Switcher (Visible on <lg screens) */}
          <div className="lg:hidden flex items-center p-1 bg-stone-100 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46]">
            <button
              type="button"
              onClick={() => setMobileReadingTab('article')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[42px] ${
                mobileReadingTab === 'article'
                  ? 'bg-white dark:bg-[#1E2B30] text-[#174A5B] dark:text-[#75B6CE] shadow-2xs font-bold'
                  : 'text-[#68777C] dark:text-[#9CAEB3]'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>阅读文章</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileReadingTab('questions')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[42px] ${
                mobileReadingTab === 'questions'
                  ? 'bg-white dark:bg-[#1E2B30] text-[#174A5B] dark:text-[#75B6CE] shadow-2xs font-bold'
                  : 'text-[#68777C] dark:text-[#9CAEB3]'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>题目作答 (#{activeQuestionNumber})</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
            {/* Left Passage Pane */}
            <div
              className={`${
                splitPaneRatio === '5:7'
                  ? 'lg:col-span-5'
                  : splitPaneRatio === '6:6'
                  ? 'lg:col-span-6'
                  : 'lg:col-span-7'
              } bg-[#FBFAF6] dark:bg-[#1B262A] rounded-2xl border border-stone-200/80 dark:border-[#2C3E46] shadow-xs p-4 sm:p-7 lg:sticky lg:top-40 lg:max-h-[calc(100dvh-10.5rem)] lg:overflow-y-auto space-y-6 ${
                mobileReadingTab === 'article' ? 'block' : 'hidden lg:block'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 dark:border-[#26373E] pb-4">
                <div>
                  <h1 className="text-base sm:text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                    {currentUnit.title}
                  </h1>
                  <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] mt-0.5">
                    {currentUnit.instructions}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="hidden lg:inline-flex items-center">
                    <SegmentedTabs
                      size="xs"
                      ariaLabel="左右栏宽比例"
                      value={splitPaneRatio}
                      onChange={setSplitPaneRatio}
                      options={[
                        { id: '7:5', label: '7:5 精读' },
                        { id: '6:6', label: '6:6 均衡' },
                        { id: '5:7', label: '5:7 刷题' },
                      ]}
                    />
                  </div>
                  {currentUnit.unitType === 'reading' &&
                    currentUnit.materials[0] && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCaptureSelectionHighlight(
                            currentUnit.materials[0].id
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] rounded-lg transition-colors"
                      >
                        <Highlighter className="w-3.5 h-3.5" />
                        <span>高亮选中句</span>
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={handleLocateUnfinished}
                    className="px-3 py-1.5 text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] rounded-lg transition-colors"
                  >
                    定位未做题
                  </button>
                </div>
              </div>

              {currentUnit.materials.map((mat) => {
                const paragraphs =
                  mat.paragraphs && mat.paragraphs.length > 0
                    ? mat.paragraphs
                    : mat.text.split(/\n{2,}/).filter(Boolean);
                return (
                  <article
                    key={mat.id}
                    style={{
                      fontSize: `${Math.max(typographyPrefs.fontSizePx, 16)}px`,
                      lineHeight: typographyPrefs.lineHeight || 1.8,
                      maxWidth: `${typographyPrefs.measureCh}ch`,
                    }}
                    className="font-english-serif text-[#202B2F] dark:text-[#E2E8E6] space-y-5 mx-auto text-justify"
                  >
                    {paragraphs.map((paraText, pIdx) => {
                      const pKey = `${mat.id}-${pIdx}`;
                      const isFlashed = highlightedParagraphKey === pKey;
                      return (
                        <p
                          key={pIdx}
                          id={`passage-para-${pKey}`}
                          className={`leading-relaxed tracking-normal rounded-lg transition-colors ${
                            isFlashed ? 'highlight-flash px-2 py-1 -mx-2' : ''
                          }`}
                        >
                          <span className="font-tabular-mono text-xs text-[#96A1A4] dark:text-[#657980] mr-2.5 select-none font-medium">
                            [{pIdx + 1}]
                          </span>
                          {currentUnit.unitType === 'cloze'
                            ? renderClozePassage(paraText)
                            : renderTextWithSafeUnderline(paraText)}
                        </p>
                      );
                    })}

                    {(highlightedQuotes[mat.id] || []).length > 0 && (
                      <div className="mt-6 pt-4 border-t border-stone-100 dark:border-[#26373E] font-sans text-xs space-y-2">
                        <div className="font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                          已摘录重点句 ({highlightedQuotes[mat.id].length})：
                        </div>
                        <div className="space-y-1.5">
                          {highlightedQuotes[mat.id].map((qt, i) => (
                            <div
                              key={i}
                              className="p-3 bg-stone-50 dark:bg-[#162226] rounded-lg border border-stone-200/80 dark:border-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6] font-english-serif text-xs leading-relaxed"
                            >
                              “{qt}”
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}

              {/* Mobile Quick Action: Jump to active question */}
              <div className="lg:hidden sticky bottom-2 z-10 pt-4">
                <button
                  type="button"
                  onClick={() => setMobileReadingTab('questions')}
                  className="w-full py-3 px-4 bg-[#174A5B] dark:bg-[#38849E] text-white rounded-xl shadow-md text-xs font-semibold flex items-center justify-between transition-transform active:scale-[0.99]"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4" />
                    <span>当前正在作答：第 #{activeQuestionNumber} 题</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-bold">
                    <span>前往答题</span>
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </button>
              </div>
            </div>

            {/* Right Question Cards Pane */}
            <div
              className={`${
                splitPaneRatio === '5:7'
                  ? 'lg:col-span-7'
                  : splitPaneRatio === '6:6'
                  ? 'lg:col-span-6'
                  : 'lg:col-span-5'
              } space-y-4 ${
                mobileReadingTab === 'questions' ? 'block' : 'hidden lg:block'
              }`}
            >
              {/* Mobile Quick Action: Jump to article */}
              <div className="lg:hidden flex items-center justify-between p-2.5 bg-stone-50 dark:bg-[#162226] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] text-xs">
                <span className="text-[#68777C] dark:text-[#9CAEB3]">
                  正在作答：第 <strong className="text-[#174A5B] dark:text-[#75B6CE]">#{activeQuestionNumber}</strong> 题
                </span>
                <button
                  type="button"
                  onClick={() => setMobileReadingTab('article')}
                  className="inline-flex items-center gap-1 font-semibold text-[#174A5B] dark:text-[#75B6CE] hover:underline"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>查看对应原文段落</span>
                </button>
              </div>

              {/* Top Question Switcher & Display Mode Toggle (sticky in right pane) */}
              <div className="bg-white dark:bg-[#1E2B30] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] p-3 flex items-center justify-between gap-2 shadow-xs lg:sticky lg:top-40 z-10">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  {currentUnit.items.map((it) => {
                    const qN = it.questionNumber;
                  const resp = attempt.objectiveResponses[qN];
                  const isCurrent = qN === activeQuestionNumber;
                  const hasAns = Boolean(resp?.selectedAnswer);
                  const isOfficialCorrect =
                    isSubmitted && it.correctAnswer && resp?.selectedAnswer === it.correctAnswer;
                  const isSelectedWrong =
                    isSubmitted && it.correctAnswer && resp?.selectedAnswer && resp.selectedAnswer !== it.correctAnswer;

                  return (
                    <button
                      key={qN}
                      type="button"
                      onClick={() => {
                        setActiveQuestionNumber(qN);
                        if (questionDisplayMode === 'all') {
                          const el = document.getElementById(`question-card-${qN}`);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }}
                      className={`px-2.5 py-1 rounded-md font-tabular-mono text-xs font-semibold transition-all shrink-0 ${
                        isCurrent
                          ? 'bg-[#174A5B] dark:bg-[#38849E] text-white shadow-2xs'
                          : isOfficialCorrect
                          ? 'bg-emerald-50 dark:bg-[#172E27] text-emerald-800 dark:text-[#4EA387] border border-emerald-300 dark:border-emerald-800'
                          : isSelectedWrong
                          ? 'bg-rose-50 dark:bg-[#351C1A] text-rose-800 dark:text-[#CF695E] border border-rose-300 dark:border-rose-900'
                          : hasAns
                          ? 'bg-stone-100 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border border-stone-300 dark:border-[#2C3E46]'
                          : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] hover:bg-stone-100 dark:hover:bg-[#162226]'
                      }`}
                    >
                      #{qN}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() =>
                  setQuestionDisplayMode((prev) => (prev === 'single' ? 'all' : 'single'))
                }
                className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] px-2.5 py-1 bg-stone-100 dark:bg-[#162226] hover:bg-stone-200/80 dark:hover:bg-[#203036] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {questionDisplayMode === 'single' ? '展开全部' : '聚焦单题'}
              </button>
            </div>

            <div className="hidden md:flex items-center justify-between text-[11px] text-[#68777C] dark:text-[#9CAEB3] px-1">
              <span>键盘快捷操作：J/K 切换题号 · A–D 选中答案 · 1/2/3 标记把握度 · F 标记疑难</span>
            </div>

            {/* Questions Rendering (Single or All) */}
            {(questionDisplayMode === 'single'
              ? [
                  currentUnit.items.find((i) => i.questionNumber === activeQuestionNumber) ||
                    currentUnit.items[0],
                ]
              : currentUnit.items.filter((item) => {
                  if (!isSubmitted || reviewFilter === 'all') return true;
                  const r = attempt.objectiveResponses[item.questionNumber];
                  if (reviewFilter === 'flagged') return Boolean(r?.flaggedForReview);
                  if (reviewFilter === 'wrong') {
                    return Boolean(item.correctAnswer) && r?.selectedAnswer !== item.correctAnswer;
                  }
                  return true;
                })
            ).map((item) => {
              if (!item) return null;
              const qNum = item.questionNumber;
              const currentIdx = currentUnit.items.findIndex(
                (i) => i.questionNumber === qNum
              );

              return (
                <ObjectiveQuestionCard
                  key={item.id}
                  item={item}
                  unit={currentUnit}
                  resp={attempt.objectiveResponses[qNum]}
                  isActive={activeQuestionNumber === qNum}
                  isSubmitted={isSubmitted}
                  compactReview={isCompactReview}
                  anyModelAvailable={anyModelAvailable}
                  isAnalyzing={analyzingQuestionNum === qNum}
                  aiAnalysis={objectiveAnalyses[`${exam.year}-q${qNum}`]}
                  showSingleNav={questionDisplayMode === 'single'}
                  currentIndex={currentIdx}
                  totalCountInUnit={currentUnit.items.length}
                  knownErrorCauseOptions={KNOWN_ERROR_CAUSE_OPTIONS}
                  followUpHistory={followUpHistory[`${exam.year}:${qNum}`] || []}
                  isAskingFollowUp={askingFollowUpQ === qNum}
                  renderTextWithSafeUnderline={renderTextWithSafeUnderline}
                  onActivate={setActiveQuestionNumber}
                  onSelectOption={handleSelectOption}
                  onSelectConfidence={handleSelectConfidence}
                  onToggleFlag={handleToggleFlag}
                  onToggleKnownErrorCause={handleToggleKnownErrorCause}
                  onUpdateUserNotes={(qn, notes) =>
                    onUpdateObjectiveResponse(qn, {
                      questionNumber: qn,
                      userNotes: notes,
                    })
                  }
                  onNavigateQuestion={(dir) => {
                    const targetIdx =
                      dir === 'prev'
                        ? Math.max(0, currentIdx - 1)
                        : Math.min(currentUnit.items.length - 1, currentIdx + 1);
                    const nextQ = currentUnit.items[targetIdx]?.questionNumber;
                    if (nextQ !== undefined) setActiveQuestionNumber(nextQ);
                  }}
                  onRequestAnalysis={async (it, un, ans, conf) => {
                    try {
                      setAnalyzingQuestionNum(it.questionNumber);
                      await onRequestObjectiveAnalysis(it, un, ans, conf);
                    } catch (err: any) {
                      setAiErrorBanner(err?.message || '客观题 AI 解析失败');
                    } finally {
                      setAnalyzingQuestionNum(null);
                    }
                  }}
                  onLocateEvidenceQuote={handleLocateEvidenceQuote}
                  onAskFollowUp={handleAskQuestionFollowUp}
                />
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* UNIT TYPE 3: PART B PASSAGE ASSEMBLY (41–45, A–G with Fixed E) */}
      {currentUnit.unitType === 'passage-assembly' && partBSpec && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Main Passage Flow with Slots 41-45 and Fixed E */}
          <div
            className={`${
              splitPaneRatio === '5:7'
                ? 'lg:col-span-5'
                : splitPaneRatio === '6:6'
                ? 'lg:col-span-6'
                : 'lg:col-span-7'
            } bg-[#FBFAF6] dark:bg-[#1B262A] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-4 shadow-xs`}
          >
            <div className="border-b border-[#E8ECEA] dark:border-[#223036] pb-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                  {currentUnit.title}
                </h1>
                <div className="hidden lg:inline-flex items-center">
                  <SegmentedTabs
                    size="xs"
                    ariaLabel="新题型左右栏宽比例"
                    value={splitPaneRatio}
                    onChange={setSplitPaneRatio}
                    options={[
                      { id: '7:5', label: '7:5 精读' },
                      { id: '6:6', label: '6:6 均衡' },
                      { id: '5:7', label: '5:7 匹配' },
                    ]}
                  />
                </div>
              </div>
              <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                {currentUnit.instructions}
              </p>
              <div className="text-xs text-[#174A5B] dark:text-[#75B6CE] font-medium pt-1">
                操作方式：支持将右侧候选段落 A–G 拖拽至左侧空位，或先点击左侧目标题号（如 41）再点击右侧候选段落填入。第 [E] 段为已给定的固定锚点段落。
              </div>
            </div>

            <div className="space-y-3">
              {partBSpec.sequenceSlots.map((slot, index) => {
                if (slot.type === 'fixed') {
                  const fixedPara = partBSpec.candidateParagraphs.find(
                    (c) => c.id === (slot.fixedParagraphId || 'E')
                  );
                  return (
                    <div
                      key={`fixed-${index}`}
                      className="p-4 bg-stone-50 dark:bg-[#162226] border-2 border-[#174A5B] dark:border-[#38849E] rounded-xl space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                        <span>
                          固定段落 [{slot.fixedParagraphId || 'E'}]（试卷给定锚点 · 不计入 41–45 评分项）
                        </span>
                        <span className="font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                          FIXED ANCHOR
                        </span>
                      </div>
                      <p className="font-english-serif text-sm text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed">
                        {fixedPara?.text}
                      </p>
                    </div>
                  );
                }

                const qNum = slot.questionNumber || 41;
                const resp = attempt.objectiveResponses[qNum];
                const assignedId = resp?.selectedAnswer || '';
                const assignedCandidate = partBSpec.candidateParagraphs.find(
                  (c) => c.id === assignedId
                );
                const item = currentUnit.items.find(
                  (it) => it.questionNumber === qNum
                );
                const officialAns = item?.correctAnswer;
                const isSelectedSlot = selectedPartBSlot === qNum;

                return (
                  <div
                    key={`slot-${qNum}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedId = e.dataTransfer.getData('text/plain');
                      if (droppedId) {
                        handleAssignPartBCandidate(qNum, droppedId);
                      }
                    }}
                    onClick={() => setSelectedPartBSlot(qNum)}
                    className={`p-4 border rounded-xl transition-colors cursor-pointer space-y-2 ${
                      isSelectedSlot
                        ? 'border-2 border-[#174A5B] dark:border-[#38849E] bg-[#E8F0F1]/60 dark:bg-[#19313A]/60'
                        : 'border-[#DCE4E1] dark:border-[#2C3E46] bg-white dark:bg-[#1E2B30] hover:border-[#174A5B] dark:hover:border-[#38849E]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs font-tabular-mono font-bold bg-[#174A5B] dark:bg-[#38849E] text-white rounded">
                          第 {qNum} 题空位
                        </span>
                        {assignedId ? (
                          <span className="text-xs font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                            已填入段落 [{assignedId}]
                          </span>
                        ) : (
                          <span className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                            尚未填入（点击选中此空位后在右侧选择 A–G，或直接拖入）
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {assignedId && !isSubmitted && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateObjectiveResponse(qNum, {
                                questionNumber: qNum,
                                selectedAnswer: '',
                              });
                            }}
                            className="text-xs text-[#A8544A] dark:text-[#CF695E] hover:underline"
                          >
                            清空
                          </button>
                        )}
                        {isSubmitted && officialAns && (
                          <span
                            className={`text-xs font-tabular-mono font-semibold ${
                              assignedId === officialAns
                                ? 'text-[#3F7664] dark:text-[#4EA387]'
                                : 'text-[#A8544A] dark:text-[#CF695E]'
                            }`}
                          >
                            {assignedId === officialAns
                              ? `✓ 正确 (${officialAns})`
                              : `✗ 你的答案: ${assignedId || '空'} / 官方答案: ${officialAns}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {assignedCandidate && (
                      <p className="font-english-serif text-sm text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed bg-[#F1F5F3] dark:bg-[#162226] p-3 border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg">
                        <strong>[{assignedCandidate.id}]</strong>{' '}
                        {assignedCandidate.text}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Candidate Paragraph Pool A-G */}
          <div
            className={`${
              splitPaneRatio === '5:7'
                ? 'lg:col-span-7'
                : splitPaneRatio === '6:6'
                ? 'lg:col-span-6'
                : 'lg:col-span-5'
            } bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-4 lg:sticky lg:top-32 lg:max-h-[calc(100vh-9.5rem)] lg:overflow-y-auto shadow-xs`}
          >
            <div className="flex items-center justify-between border-b border-[#E8ECEA] dark:border-[#223036] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                  候选段落池 (A—G · 含 1 个多余干扰段)
                </h2>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                  当前目标填入位置：
                  <strong className="font-tabular-mono text-[#174A5B] dark:text-[#75B6CE] ml-1">
                    第 {selectedPartBSlot} 题
                  </strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-[#68777C] dark:text-[#9CAEB3] whitespace-nowrap text-[11px] shrink-0">选择空位：</span>
              {[41, 42, 43, 44, 45].map((sNum) => {
                const ans = attempt.objectiveResponses[sNum]?.selectedAnswer;
                const isSelected = selectedPartBSlot === sNum;
                return (
                  <button
                    key={sNum}
                    type="button"
                    onClick={() => setSelectedPartBSlot(sNum)}
                    className={`px-2.5 py-1 rounded-md font-tabular-mono font-semibold transition-all shrink-0 min-h-[32px] ${
                      isSelected
                        ? 'bg-[#174A5B] dark:bg-[#38849E] text-white shadow-2xs'
                        : ans
                        ? 'bg-stone-100 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border border-[#DCE4E1] dark:border-[#2C3E46]'
                        : 'bg-stone-50 dark:bg-[#162226] text-[#68777C] dark:text-[#9CAEB3] border border-dashed border-[#DCE4E1] dark:border-[#2C3E46]'
                    }`}
                  >
                    #{sNum} {ans ? `[${ans}]` : ''}
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              {partBSpec.candidateParagraphs.map((cand) => {
                const isFixed = partBSpec.fixedPlacements.some(
                  (fp) => fp.paragraphId === cand.id
                );
                const usedByQuestion = [41, 42, 43, 44, 45].find(
                  (q) =>
                    attempt.objectiveResponses[q]?.selectedAnswer === cand.id
                );

                return (
                  <div
                    key={cand.id}
                    draggable={!isFixed && !isSubmitted}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', cand.id);
                    }}
                    className={`p-3.5 border rounded-xl space-y-2 transition-colors ${
                      isFixed
                        ? 'bg-stone-50 dark:bg-[#162226] border-[#DCE4E1] dark:border-[#2C3E46] opacity-75'
                        : usedByQuestion
                        ? 'bg-[#E8F0F1]/60 dark:bg-[#19313A]/60 border-[#174A5B] dark:border-[#38849E]'
                        : 'bg-white dark:bg-[#1E2B30] border-[#DCE4E1] dark:border-[#2C3E46] hover:border-[#174A5B] dark:hover:border-[#38849E]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-tabular-mono text-xs font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                        候选段落 [{cand.id}]
                        {isFixed ? ' (固定段落)' : ''}
                      </span>
                      {!isFixed && !isSubmitted && (
                        <button
                          type="button"
                          onClick={() =>
                            handleAssignPartBCandidate(
                              selectedPartBSlot,
                              cand.id
                            )
                          }
                          className="px-2.5 py-1 text-xs font-medium text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-md transition-colors"
                        >
                          {usedByQuestion
                            ? `已用于 ${usedByQuestion} 题 (改填至 ${selectedPartBSlot})`
                            : `填入第 ${selectedPartBSlot} 题`}
                        </button>
                      )}
                    </div>
                    <p className="font-english-serif text-xs text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed">
                      {cand.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* UNIT TYPE 4, 5, 6: SUBJECTIVE UNITS */}
      {(currentUnit.unitType === 'translation' ||
        currentUnit.unitType === 'practical-writing' ||
        currentUnit.unitType === 'visual-writing') && (
        <EnglishSubjectiveStudio
          examYear={exam.year}
          currentUnit={currentUnit}
          anyModelAvailable={anyModelAvailable}
          activeProviderName={activeProviderName}
          typographyPrefs={typographyPrefs}
          practiceMode={practiceMode}
          onSelectPracticeMode={(mode) => {
            setPracticeMode(mode);
            if (
              mode === 'guided' &&
              !usedHints.some((h) => h.id === 'hint-scaffold')
            ) {
              setUsedHints((prev) => [
                ...prev,
                {
                  id: 'hint-scaffold',
                  level: 1,
                  title: '句法与段落结构提示',
                  content: '已开启引导练习结构支架',
                  usedAt: new Date().toISOString(),
                },
              ]);
            }
          }}
          translationInputs={translationInputs}
          onChangeTranslationInput={(qNum, val) =>
            setTranslationInputs((prev) => ({ ...prev, [qNum]: val }))
          }
          writingDraft={writingDraft}
          onChangeWritingDraft={setWritingDraft}
          unitVersions={unitVersions}
          selectedVersion={selectedVersion}
          compareBaseVersion={compareBaseVersion}
          selectedEvaluation={selectedEvaluation}
          subjectiveEvaluations={subjectiveEvaluations}
          versionDiffResult={versionDiffResult}
          showDiffPanel={showDiffPanel}
          onToggleDiffPanel={() => setShowDiffPanel((p) => !p)}
          onSelectVersionId={setSelectedVersionId}
          onSelectCompareBaseVersionId={setCompareBaseVersionId}
          evaluatingVersionId={evaluatingVersionId}
          onSaveVersion={handleSaveSubjectiveVersion}
          onEvaluateExistingVersion={async (version) => {
            try {
              setEvaluatingVersionId(version.id);
              await onRequestSubjectiveEvaluation(version, currentUnit);
            } catch (err: any) {
              setAiErrorBanner(err?.message || 'AI 批改失败');
            } finally {
              setEvaluatingVersionId(null);
            }
          }}
          aiScaffolds={aiScaffolds}
          loadingScaffold={loadingScaffold}
          onGenerateScaffold={
            onRequestWritingScaffold
              ? async () => {
                  try {
                    setLoadingScaffold(true);
                    const scaffold = await onRequestWritingScaffold({
                      unitType: currentUnit.unitType as
                        | 'translation'
                        | 'practical-writing'
                        | 'visual-writing',
                      promptText:
                        currentUnit.items
                          .map(
                            (i) =>
                              i.translationMeta?.underlinedEnglish || i.prompt
                          )
                          .join('\n') || currentUnit.instructions,
                      requiredFacts:
                        visualMat?.requiredFacts ||
                        practicalSpec?.requiredPoints,
                    });
                    setAiScaffolds((prev) => ({
                      ...prev,
                      [currentUnit.id]: scaffold,
                    }));
                  } catch (err: any) {
                    setAiErrorBanner(err?.message || '生成 AI 结构支架失败');
                  } finally {
                    setLoadingScaffold(false);
                  }
                }
              : undefined
          }
          practicalSpec={practicalSpec}
          visualMat={visualMat}
          visualMats={visualMats}
          subjectiveBaseSec={subjectiveBaseSec}
          renderTimerReadout={(baseSec) => (
            <SubjectiveTimerReadout baseElapsedSeconds={baseSec} />
          )}
          renderTextWithSafeUnderline={renderTextWithSafeUnderline}
          countEnglishWords={countEnglishWords}
          followUpHistory={
            followUpHistory[`${exam.year}:${currentUnit.items[0]?.questionNumber || 46}`] || []
          }
          isAskingFollowUp={askingFollowUpQ !== null}
          onSendFollowUp={async (qText) => {
            const qNum = currentUnit.items[0]?.questionNumber || 46;
            try {
              setAskingFollowUpQ(qNum);
              const passageText = currentUnit.materials
                .map((m) => m.text)
                .join('\n\n');
              const promptText =
                currentUnit.items
                  .map(
                    (i) => i.translationMeta?.underlinedEnglish || i.prompt
                  )
                  .join('\n') || currentUnit.instructions;
              const userAnswerText =
                selectedVersion?.content ||
                writingDraft ||
                Object.values(translationInputs).filter(Boolean).join('\n');
              const prevSummary = selectedEvaluation
                ? `得分 ${selectedEvaluation.centralScore}/${selectedEvaluation.maxScore}；改进建议：${selectedEvaluation.revisionTasks
                    .map((r) => r.instruction)
                    .join('；')}`
                : undefined;
              const reply = await onAskFollowUp({
                questionNumber: qNum,
                questionContext: currentUnit.title,
                unitId: currentUnit.id,
                unitTitle: currentUnit.title,
                passageText,
                promptText,
                userAnswer: userAnswerText,
                isSubmitted: Boolean(selectedVersion) || isSubmitted,
                userQuestion: qText,
                previousAnalysisSummary: prevSummary,
              });
              const subjFollowUpKey = `${exam.year}:${qNum}`;
              setFollowUpHistory((prev) => ({
                ...prev,
                [subjFollowUpKey]: [...(prev[subjFollowUpKey] || []), { q: qText, a: reply }],
              }));
            } catch (err: any) {
              setAiErrorBanner(err?.message || '追问请求失败');
            } finally {
              setAskingFollowUpQ(null);
            }
          }}
          onNavigateSettings={onNavigateSettings}
          usedHints={usedHints}
        />
      )}

      {/* Accessible Answer Sheet Modal */}
      <ModalDialog
        isOpen={showAnswerSheet}
        onClose={() => setShowAnswerSheet(false)}
        ariaLabel={
          exam.subject === '考研政治' ? '全卷 1—38 题答题卡' : '全卷 1—52 题答题卡'
        }
        title={`${formatExamTitle(exam.year, exam.subject)} 答题卡（${
          exam.subject === '考研政治' ? '1—38 题' : '1—52 题'
        }）`}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4 text-xs">
          {allUnits.map((u) => (
            <div key={u.id} className="space-y-2">
              <div className="font-semibold text-ink">{u.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {u.items.map((it) => {
                  const q = it.questionNumber;
                  const resp = attempt.objectiveResponses[q];
                  const hasSubj = subjectiveVersions.some((v) => {
                    if (v.year !== exam.year) return false;
                    if (u.unitType === 'translation') {
                      return (
                        v.unitId === u.id &&
                        (v.subAnswers ? Boolean(v.subAnswers[q]?.trim()) : true)
                      );
                    }
                    return v.questionNumber === q;
                  });
                  const isDone = Boolean(resp?.selectedAnswer) || hasSubj;
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        const isSameUnit = currentUnit?.id === u.id;
                        const isPartB = u.unitType === 'passage-assembly';
                        if (isPoliticsWorkspace) {
                          onSelectUnit(u.id);
                          setActiveQuestionNumber(q);
                          if (reviewFilter !== 'all') {
                            setReviewFilter('all');
                          }
                          window.setTimeout(() => {
                            document
                              .getElementById(`question-card-${q}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 80);
                          setShowAnswerSheet(false);
                          return;
                        }
                        if (!isSameUnit) {
                          pendingUnitJumpRef.current = {
                            unitId: u.id,
                            qNum: q,
                            isPartB,
                          };
                          onSelectUnit(u.id);
                        } else {
                          setActiveQuestionNumber(q);
                          if (isPartB) {
                            setSelectedPartBSlot(q);
                          }
                        }
                        if (!isPartB) {
                          setMobileReadingTab('questions');
                          window.setTimeout(() => {
                            document
                              .getElementById(`question-card-${q}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 80);
                        }
                        setShowAnswerSheet(false);
                      }}
                      className={`w-10 h-9 font-tabular-mono border text-xs rounded-md flex flex-col items-center justify-center transition-colors ${
                        isDone
                          ? 'bg-brand text-white border-brand font-semibold'
                          : 'bg-card-subtle text-ink border-subtle hover:bg-stone-100 dark:hover:bg-[#203036]'
                      }`}
                    >
                      <span>{q}</span>
                      {resp?.selectedAnswer && (
                        <span className="text-[10px]">{resp.selectedAnswer}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ModalDialog>

      {/* Submit Attempt Confirmation Modal */}
      <ModalDialog
        isOpen={submitConfirmModal}
        onClose={() => setSubmitConfirmModal(false)}
        ariaLabel="确认交卷评分"
        title="确认交卷并执行客观题确定性评分"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setSubmitConfirmModal(false)}
              className="px-4 py-2 text-xs font-medium text-secondary hover:bg-stone-100 dark:hover:bg-[#162226] rounded-lg transition-colors"
            >
              继续检查
            </button>
            <button
              type="button"
              onClick={() => {
                setSubmitConfirmModal(false);
                onSubmitAttempt();
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-brand hover:bg-brand-hover rounded-lg transition-colors shadow-xs"
            >
              确认交卷评分
            </button>
          </>
        }
      >
        <p className="text-xs text-secondary leading-relaxed">
          当前已完成客观题：
          <strong className="font-tabular-mono text-ink mx-1">
            {answeredObjectiveCount} / {totalObjectiveCount}
          </strong>
          题。交卷后将立即核对{' '}
          {exam.subject === '考研政治' ? '1–33 题' : `1–${totalObjectiveCount} 题`}
          官方答案、计算客观题得分，并将错题、自信答错题与猜测题自动加入间隔复习队列。
        </p>
      </ModalDialog>
    </div>
  );
};
