import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Clock,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  Flag,
  Layers,
  Send,
  History,
  GitCompare,
  Pause,
  Play,
  Sliders,
  Highlighter,
  X,
  ChevronLeft,
  ChevronRight,
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
  WritingScaffoldResult,
} from '../shared/types';
import { computeVersionDiff } from '../shared/schemaValidator';
import { ReadingTypographyPrefs } from '../services/storageAndSync';
import { CulturalHotpotIllustration } from './CulturalHotpotIllustration';

interface StudyWorkspaceViewProps {
  exam: Exam;
  activeUnitId: string;
  attempt: ExamAttempt;
  subjectiveVersions: SubjectiveAnswerVersion[];
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  objectiveAnalyses: Record<string, ObjectiveAIAnalysis>;
  anyModelAvailable: boolean;
  activeProviderName: string | null;
  typographyPrefs: ReadingTypographyPrefs;
  onUpdateTypographyPrefs: (prefs: ReadingTypographyPrefs) => void;
  onSelectUnit: (unitId: string) => void;
  onUpdateObjectiveResponse: (
    questionNumber: number,
    patch: Partial<ObjectiveItemResponse>
  ) => void;
  onTickTimer: (deltaSeconds: number) => void;
  onSubmitAttempt: () => void;
  onSubmitSubjectiveVersion: (params: {
    unitId: string;
    unitType: 'translation' | 'practical-writing' | 'visual-writing';
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
  attempt,
  subjectiveVersions,
  subjectiveEvaluations,
  objectiveAnalyses,
  anyModelAvailable,
  activeProviderName,
  typographyPrefs,
  onUpdateTypographyPrefs,
  onSelectUnit,
  onUpdateObjectiveResponse,
  onTickTimer,
  onSubmitAttempt,
  onSubmitSubjectiveVersion,
  onRequestSubjectiveEvaluation,
  onRequestObjectiveAnalysis,
  onAskFollowUp,
  onRequestWritingScaffold,
  onExitWorkspace,
  onNavigateSettings,
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
  const [activeQuestionNumber, setActiveQuestionNumber] = useState<number>(
    currentUnit?.items[0]?.questionNumber || 1
  );
  const [questionDisplayMode, setQuestionDisplayMode] = useState<'single' | 'all'>('single');
  const [mobileReadingTab, setMobileReadingTab] = useState<'article' | 'questions'>('questions');

  // Reading Highlight & Note state
  const [highlightedQuotes, setHighlightedQuotes] = useState<
    Record<string, string[]>
  >({});

  // Part B active slot selection
  const [selectedPartBSlot, setSelectedPartBSlot] = useState<number>(41);

  // Subjective practice states
  const [practiceMode, setPracticeMode] =
    useState<SubjectivePracticeMode>('independent');
  const [usedHints, setUsedHints] = useState<HintRecord[]>([]);
  const [translationInputs, setTranslationInputs] = useState<
    Record<number, string>
  >({
    46: '',
    47: '',
    48: '',
    49: '',
    50: '',
  });
  const [writingDraft, setWritingDraft] = useState<string>('');
  const [subjectiveElapsed, setSubjectiveElapsed] = useState<number>(0);
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

  // Follow-up Q&A state
  const [followUpInput, setFollowUpInput] = useState<string>('');
  const [followUpHistory, setFollowUpHistory] = useState<
    Record<number, { q: string; a: string }[]>
  >({});
  const [askingFollowUpQ, setAskingFollowUpQ] = useState<number | null>(null);
  const [aiScaffolds, setAiScaffolds] = useState<
    Record<string, WritingScaffoldResult>
  >({});
  const [loadingScaffold, setLoadingScaffold] = useState<boolean>(false);

  const isStrictSimulation = attempt.mode === 'strict-simulation';
  const isSubmitted = attempt.status === 'submitted';

  useEffect(() => {
    if (currentUnit?.items[0]) {
      setActiveQuestionNumber(currentUnit.items[0].questionNumber);
    }
    setAiErrorBanner(null);
  }, [currentUnit?.id]);

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
  }, [unitVersions.length, currentUnit?.id]);

  // Timer effect
  useEffect(() => {
    if (isSubmitted || (isPaused && !isStrictSimulation)) return;
    const timer = window.setInterval(() => {
      onTickTimer(1);
      setSubjectiveElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isSubmitted, isPaused, isStrictSimulation, onTickTimer]);

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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const remainingSimulationSec = Math.max(
    0,
    exam.durationMinutes * 60 - attempt.elapsedSeconds
  );

  const answeredObjectiveCount = Object.values(
    attempt.objectiveResponses
  ).filter((r) => Boolean(r.selectedAnswer)).length;

  const handleSelectOption = (questionNumber: number, optionKey: string) => {
    if (isSubmitted) return;
    const existing = attempt.objectiveResponses[questionNumber];
    onUpdateObjectiveResponse(questionNumber, {
      questionNumber,
      selectedAnswer: optionKey,
      confidence: existing?.confidence || 'certain',
    });
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

  const handleLocateUnfinished = () => {
    const firstUnfinished = currentUnit.items.find(
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
        durationSeconds: subjectiveElapsed,
        usedHints,
      });
      setSelectedVersionId(created.id);
      setSubjectiveElapsed(0);
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
        durationSeconds: subjectiveElapsed,
        usedHints,
      });
      setSelectedVersionId(created.id);
      setSubjectiveElapsed(0);
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

  return (
    <div className="space-y-4">
      {/* Top Workspace Control Bar */}
      <header className="bg-white/95 dark:bg-[#1C262B]/95 backdrop-blur-xs rounded-xl border border-stone-200/90 dark:border-[#2C3E46] shadow-xs p-2.5 sm:p-4 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 sticky top-14 z-20 transition-all">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onExitWorkspace}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>退出</span>
          </button>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-stone-900 dark:text-[#E2E8E6]">
                {exam.year}年 考研英语一
              </span>
              <span className="text-xs text-stone-400 dark:text-[#657980]">·</span>
              <span className="text-xs text-stone-600 dark:text-[#9CAEB3] font-medium">
                {attempt.mode === 'strict-simulation'
                  ? '整卷严格模拟'
                  : attempt.mode === 'free-simulation'
                  ? '整卷自由模拟'
                  : '单项训练'}
              </span>
              {exam.answerSourceStatus === 'unavailable' && (
                <span className="text-xs text-amber-700 dark:text-[#E5B55E] bg-amber-50 dark:bg-[#2E2413] px-2 py-0.5 rounded font-medium">
                  该年暂无官方答案，不计客观题总分
                </span>
              )}
              {isSubmitted && (
                <span className="text-xs text-emerald-800 dark:text-[#4EA387] bg-emerald-50 dark:bg-[#172E27] px-2 py-0.5 rounded font-semibold font-tabular-mono">
                  {exam.answerSourceStatus === 'unavailable'
                    ? '已保存作答'
                    : `已交卷 · 客观题 ${attempt.totalObjectiveScore ?? 0} / ${
                        attempt.maxObjectiveScore ?? 60
                      } 分`}
                </span>
              )}
            </div>
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#9CAEB3]">
            <span className="sr-only">切换试卷单元</span>
            <select
              aria-label="切换试卷单元"
              value={currentUnit.id}
              onChange={(e) => onSelectUnit(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium text-stone-800 dark:text-[#E2E8E6] bg-stone-50 dark:bg-[#162226] border border-stone-200 dark:border-[#2C3E46] rounded-lg focus:outline-none focus:border-[#174A5B] dark:focus:border-[#38849E]"
            >
              {allUnits.map((u) => {
                const firstQ = u.items[0]?.questionNumber;
                const lastQ = u.items[u.items.length - 1]?.questionNumber;
                return (
                  <option key={u.id} value={u.id}>
                    {u.title} (
                    {firstQ === lastQ ? `${firstQ}题` : `${firstQ}-${lastQ}题`})
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-50 dark:bg-[#162226] border border-stone-200 dark:border-[#2C3E46] rounded-lg text-xs font-tabular-mono text-stone-800 dark:text-[#E2E8E6]">
            <Clock className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
            <span>
              {attempt.mode === 'unit-practice'
                ? `用时 ${formatDuration(attempt.elapsedSeconds)}`
                : `剩余 ${formatDuration(remainingSimulationSec)}`}
            </span>
            {!isStrictSimulation && !isSubmitted && (
              <button
                type="button"
                aria-label={isPaused ? '继续计时' : '暂停计时'}
                onClick={() => setIsPaused((p) => !p)}
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

          <span className="text-[11px] text-stone-400 dark:text-[#657980] font-tabular-mono hidden md:inline">
            已自动保存
          </span>

          {/* Typography Settings Trigger */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPrefsPopover((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-[#E2E8E6] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] rounded-lg whitespace-nowrap"
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

          <button
            type="button"
            onClick={() => setShowAnswerSheet(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-[#E2E8E6] bg-stone-50 dark:bg-[#162226] hover:bg-stone-100 dark:hover:bg-[#203036] border border-stone-200 dark:border-[#2C3E46] rounded-lg font-tabular-mono whitespace-nowrap transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
            <span>答题卡 ({answeredObjectiveCount}/45)</span>
          </button>

          {!isSubmitted && (
            <button
              type="button"
              onClick={() => setSubmitConfirmModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-lg shadow-xs whitespace-nowrap transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>交卷核对</span>
            </button>
          )}
        </div>
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
              className={`lg:col-span-7 bg-[#FBFAF6] dark:bg-[#1B262A] rounded-2xl border border-stone-200/80 dark:border-[#2C3E46] shadow-xs p-4 sm:p-7 lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto space-y-6 ${
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
                <div className="flex items-center gap-2">
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
                    {paragraphs.map((paraText, pIdx) => (
                      <p key={pIdx} className="leading-relaxed tracking-normal">
                        <span className="font-tabular-mono text-xs text-[#96A1A4] dark:text-[#657980] mr-2.5 select-none font-medium">
                          [{pIdx + 1}]
                        </span>
                        {currentUnit.unitType === 'cloze'
                          ? renderClozePassage(paraText)
                          : renderTextWithSafeUnderline(paraText)}
                      </p>
                    ))}

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
              className={`lg:col-span-5 space-y-4 ${
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

              {/* Top Question Switcher & Display Mode Toggle */}
              <div className="bg-white dark:bg-[#1E2B30] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] p-3 flex items-center justify-between gap-2 shadow-xs">
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

            {/* Questions Rendering (Single or All) */}
            {(questionDisplayMode === 'single'
              ? [
                  currentUnit.items.find((i) => i.questionNumber === activeQuestionNumber) ||
                    currentUnit.items[0],
                ]
              : currentUnit.items
            ).map((item) => {
              if (!item) return null;
              const qNum = item.questionNumber;
              const resp = attempt.objectiveResponses[qNum];
              const selectedAns = resp?.selectedAnswer || '';
              const confidence = resp?.confidence || 'certain';
              const officialAns = item.correctAnswer;
              const isCorrect =
                isSubmitted && officialAns && selectedAns === officialAns;
              const isWrong =
                isSubmitted && officialAns && selectedAns !== officialAns;
              const aiAnalysis = objectiveAnalyses[`${exam.year}-q${qNum}`];

              const currentIdx = currentUnit.items.findIndex((i) => i.questionNumber === qNum);

              return (
                <div
                  key={item.id}
                  id={`question-card-${qNum}`}
                  onClick={() => setActiveQuestionNumber(qNum)}
                  className={`bg-white dark:bg-[#1E2B30] rounded-2xl border p-5 sm:p-6 space-y-4 transition-all shadow-xs ${
                    activeQuestionNumber === qNum
                      ? 'border-[#174A5B] dark:border-[#38849E] ring-1 ring-[#174A5B]/20 dark:ring-[#38849E]/30'
                      : 'border-stone-200/80 dark:border-[#2C3E46]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-[#202B2F] dark:text-[#E2E8E6] leading-snug">
                      <span className="font-tabular-mono text-[#174A5B] dark:text-[#75B6CE] font-bold mr-2 text-base">
                        #{qNum}
                      </span>
                      <span className="font-english-serif text-base">
                        {renderTextWithSafeUnderline(item.prompt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-tabular-mono text-[#96A1A4] dark:text-[#657980]">
                        {item.score}分
                      </span>
                      <button
                        type="button"
                        aria-label={`标记第${qNum}题待复查`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFlag(qNum);
                        }}
                        className={`p-1.5 rounded-md border transition-colors ${
                          resp?.flaggedForReview
                            ? 'bg-rose-50 dark:bg-[#351C1A] border-rose-300 dark:border-rose-800 text-rose-700 dark:text-[#CF695E]'
                            : 'bg-stone-50 dark:bg-[#162226] border-stone-200 dark:border-[#2C3E46] text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
                        }`}
                      >
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Options List */}
                  <div className="grid grid-cols-1 gap-2.5">
                    {(item.options || []).map((opt) => {
                      const isSelected = selectedAns === opt.key;
                      const isOfficialCorrect =
                        isSubmitted && officialAns === opt.key;
                      const isSelectedWrong =
                        isSubmitted && isSelected && officialAns !== opt.key;

                      return (
                        <button
                          key={opt.key}
                          type="button"
                          disabled={isSubmitted}
                          onClick={() => handleSelectOption(qNum, opt.key)}
                          className={`w-full text-left px-4 py-3 rounded-xl text-sm border flex items-start gap-3 transition-all min-h-[48px] ${
                            isOfficialCorrect
                              ? 'bg-emerald-50 dark:bg-[#172E27] border-emerald-500 dark:border-[#4EA387] text-[#202B2F] dark:text-[#E2E8E6] font-medium'
                              : isSelectedWrong
                              ? 'bg-rose-50 dark:bg-[#351C1A] border-rose-400 dark:border-[#CF695E] text-[#202B2F] dark:text-[#E2E8E6]'
                              : isSelected
                              ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E] shadow-2xs'
                              : 'bg-stone-50/70 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border-stone-200/90 dark:border-[#2C3E46] hover:bg-stone-100 dark:hover:bg-[#203036] hover:border-stone-300 dark:hover:border-[#3B515B]'
                          }`}
                        >
                          <span className={`font-tabular-mono font-bold shrink-0 px-1.5 py-0.5 rounded text-xs ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-stone-200/70 dark:bg-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6]'
                          }`}>
                            {opt.key}
                          </span>
                          <span className="font-english-serif text-sm leading-relaxed pt-0.5">
                            {opt.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Confidence Selector */}
                  <div className="pt-3 border-t border-[#E8ECEA] dark:border-[#223036] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[#68777C] dark:text-[#9CAEB3]">做题把握度：</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { key: 'certain', label: '确定 (Certain)' },
                          { key: 'hesitant', label: '犹豫 (Hesitant)' },
                          { key: 'guessed', label: '猜测 (Guessed)' },
                        ] as { key: ConfidenceLevel; label: string }[]
                      ).map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          disabled={isSubmitted}
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

                  {/* Single Mode Navigation Footer */}
                  {questionDisplayMode === 'single' && (
                    <div className="pt-4 border-t border-[#E8ECEA] dark:border-[#223036] flex items-center justify-between">
                      <button
                        type="button"
                        disabled={currentIdx <= 0}
                        onClick={() =>
                          setActiveQuestionNumber(
                            currentUnit.items[currentIdx - 1].questionNumber
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>上一题</span>
                      </button>

                      <span className="text-xs font-tabular-mono text-stone-400">
                        {currentIdx + 1} / {currentUnit.items.length} 题
                      </span>

                      <button
                        type="button"
                        disabled={currentIdx >= currentUnit.items.length - 1}
                        onClick={() =>
                          setActiveQuestionNumber(
                            currentUnit.items[currentIdx + 1].questionNumber
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      >
                        <span>下一题</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Post-Submission Result & Error Cause Analysis */}
                  {isSubmitted && (
                    <div className="pt-3 border-t border-[#E8ECEA] dark:border-[#223036] space-y-3 text-xs bg-stone-50 dark:bg-[#162226] rounded-xl p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-tabular-mono font-semibold">
                          {!officialAns ? (
                            <span className="text-[#68777C] dark:text-[#9CAEB3]">
                              暂无来源答案 · 你的作答: {selectedAns || '未作答'} · 不计客观分
                            </span>
                          ) : isCorrect ? (
                            <span className="text-[#3F7664] dark:text-[#4EA387]">
                              ✓ 回答正确 · 你的答案: {selectedAns} · 官方答案: {officialAns}
                            </span>
                          ) : (
                            <span className="text-[#A8544A] dark:text-[#CF695E]">
                              ✗ 回答错误 · 你的答案: {selectedAns || '未作答'} · 官方答案: {officialAns}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={
                            !anyModelAvailable || analyzingQuestionNum === qNum
                          }
                          onClick={async () => {
                            try {
                              setAnalyzingQuestionNum(qNum);
                              await onRequestObjectiveAnalysis(
                                item,
                                currentUnit,
                                selectedAns || '未作答',
                                confidence
                              );
                            } catch (err: any) {
                              setAiErrorBanner(
                                err?.message || '客观题 AI 解析失败'
                              );
                            } finally {
                              setAnalyzingQuestionNum(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[#174A5B] dark:border-[#38849E] text-[#174A5B] dark:text-[#75B6CE] hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white disabled:opacity-50 transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            {!anyModelAvailable
                              ? '需配置模型'
                              : analyzingQuestionNum === qNum
                              ? '正在解析...'
                              : 'AI 证据句精析'}
                          </span>
                        </button>
                      </div>

                      {isWrong && (
                        <div className="space-y-1.5 pt-1">
                          <div className="font-medium text-[#202B2F] dark:text-[#E2E8E6]">
                            标记已知错因（记入错题库）：
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {KNOWN_ERROR_CAUSE_OPTIONS.map((cause) => {
                              const active = (
                                resp?.knownErrorCauses || []
                              ).includes(cause);
                              return (
                                <button
                                  key={cause}
                                  type="button"
                                  onClick={() =>
                                    handleToggleKnownErrorCause(qNum, cause)
                                  }
                                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                    active
                                      ? 'bg-rose-700 dark:bg-[#CF695E] text-white font-medium'
                                      : 'bg-white dark:bg-[#1E2B30] text-[#68777C] dark:text-[#9CAEB3] border border-[#DCE4E1] dark:border-[#2C3E46] hover:border-stone-400'
                                  }`}
                                >
                                  {cause}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {aiAnalysis && (
                        <div className="p-3 bg-white dark:bg-[#1E2B30] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-[#68777C] dark:text-[#9CAEB3] border-b border-[#E8ECEA] dark:border-[#223036] pb-1">
                            <span className="font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                              AI 辅助证据分析（非官方，仅供参考）
                            </span>
                            <span className="font-tabular-mono">
                              {aiAnalysis.modelProvider} ({aiAnalysis.modelName})
                            </span>
                          </div>
                          {aiAnalysis.dataQualityWarning && (
                            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-md text-[11px] space-y-1 text-amber-900 dark:text-amber-200">
                              <div className="font-bold">
                                ⚠ 数据源与原文语义争议提示（已与 AI 模型错误隔离）
                              </div>
                              <div className="leading-relaxed">
                                {aiAnalysis.dataQualityWarning}
                              </div>
                            </div>
                          )}
                          <div>
                            <span className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                              原文证据句定位：
                            </span>
                            <span className="font-english-serif text-[#202B2F] dark:text-[#E2E8E6] ml-1">
                              “{aiAnalysis.evidenceQuote}”
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                              解题思路结论：
                            </span>
                            <span className="text-[#202B2F] dark:text-[#E2E8E6] ml-1">
                              {aiAnalysis.transferableConclusion}
                            </span>
                          </div>
                          {aiAnalysis.possibleErrorCauses.length > 0 && (
                            <div>
                              <span className="font-semibold text-[#A8544A] dark:text-[#CF695E]">
                                干扰项与错因推测：
                              </span>
                              <span className="text-[#68777C] dark:text-[#9CAEB3] ml-1">
                                {aiAnalysis.possibleErrorCauses.join('；')}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
          <div className="lg:col-span-7 bg-[#FBFAF6] dark:bg-[#1B262A] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-4 shadow-xs">
            <div className="border-b border-[#E8ECEA] dark:border-[#223036] pb-3 space-y-1">
              <h1 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                {currentUnit.title}
              </h1>
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
          <div className="lg:col-span-5 bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-4 lg:sticky lg:top-32 lg:max-h-[calc(100vh-9.5rem)] lg:overflow-y-auto shadow-xs">
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column */}
          <div className="lg:col-span-6 bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8ECEA] dark:border-[#26373E] pb-3">
              <div>
                <h1 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                  {currentUnit.title}
                </h1>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] mt-0.5">
                  {currentUnit.instructions}
                </p>
              </div>
            </div>

            {/* Three Practice Modes Switcher */}
            <div className="p-3 bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                  主观题三阶训练模式：
                </span>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { key: 'independent', label: '1. 独立作答' },
                      { key: 'guided', label: '2. 引导练习 (结构支架)' },
                      { key: 'rewrite', label: '3. 复盘改写 (V2/V3)' },
                    ] as { key: SubjectivePracticeMode; label: string }[]
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => {
                        setPracticeMode(m.key);
                        if (
                          m.key === 'guided' &&
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
                      className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                        practiceMode === m.key
                          ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E]'
                          : 'bg-white dark:bg-[#1A2529] text-[#202B2F] dark:text-[#E2E8E6] border-[#DCE4E1] dark:border-[#2C3E46]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {practiceMode === 'guided' && (
                <div className="p-3 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] text-xs space-y-2 text-[#202B2F] dark:text-[#E2E8E6]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                      引导练习结构提示（作答提交前严禁泄露参考译文或完整范文 · 启用支架将记录独立度系数）：
                    </div>
                    {anyModelAvailable && onRequestWritingScaffold && (
                      <button
                        type="button"
                        disabled={loadingScaffold}
                        onClick={async () => {
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
                                      i.translationMeta?.underlinedEnglish ||
                                      i.prompt
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
                            setAiErrorBanner(
                              err?.message || '生成 AI 结构支架失败'
                            );
                          } finally {
                            setLoadingScaffold(false);
                          }
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium rounded border border-[#174A5B] dark:border-[#38849E] text-[#174A5B] dark:text-[#75B6CE] hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white disabled:opacity-50 transition-colors"
                      >
                        {loadingScaffold
                          ? '生成 AI 支架中...'
                          : aiScaffolds[currentUnit.id]
                          ? '重新生成 AI 定制结构支架'
                          : '生成 AI 定制三段式支架与词块'}
                      </button>
                    )}
                  </div>
                  {aiScaffolds[currentUnit.id] ? (
                    <div className="space-y-2 pt-1 border-t border-[#E8ECEA] dark:border-[#26373E]">
                      <div className="grid grid-cols-1 gap-1.5">
                        {aiScaffolds[currentUnit.id].paragraphPurposes.map(
                          (p) => (
                            <div
                              key={p.paragraphIndex}
                              className="p-2 bg-stone-50 dark:bg-[#162226] rounded border border-[#DCE4E1] dark:border-[#2C3E46]"
                            >
                              <div className="font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                                第 {p.paragraphIndex} 段（{p.title} · {p.recommendedWordCount}）：
                              </div>
                              <div className="text-[#68777C] dark:text-[#9CAEB3]">
                                写作目标：{p.purpose}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                      <div className="text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                        推荐核心表达词块：
                        <span className="font-english-serif text-[#202B2F] dark:text-[#E2E8E6] ml-1">
                          {aiScaffolds[currentUnit.id].corePhraseBank
                            .map((cp) => `${cp.phrase} (${cp.usageNote})`)
                            .join(' · ')}
                        </span>
                      </div>
                    </div>
                  ) : currentUnit.unitType === 'translation' ? (
                    <ul className="list-disc pl-4 space-y-1 text-[#68777C] dark:text-[#9CAEB3]">
                      <li>
                        (46) 句法重点：找到主干 scientists have a duty...，处理好以 because 引导的原因状语从句。
                      </li>
                      <li>
                        (47) 句法重点：Such a system 承接上文，注意 be based on 的被动转主动译法。
                      </li>
                      <li>
                        (48) 句法重点：拆解定语从句修饰关系，先译主干再顺译修饰成分。
                      </li>
                      <li>
                        (49) 句法重点：区分 bird species 与 the rest of the creatures 的并列对比结构。
                      </li>
                      <li>
                        (50) 句法重点：末句总结段意，确保代词指代与中文语序自然顺畅。
                      </li>
                    </ul>
                  ) : currentUnit.unitType === 'practical-writing' ? (
                    <ul className="list-disc pl-4 space-y-1 text-[#68777C] dark:text-[#9CAEB3]">
                      <li>
                        第一段（目的）：以研究生会名义直接表明招募国际学术会议志愿者的通知目的。
                      </li>
                      <li>
                        第二段（条件与职责）：简明列出英语流利、跨文化沟通能力、团队协作意识等核心要求。
                      </li>
                      <li>
                        第三段（报名方式）：交代报名截止时间与联系方式，礼貌收尾（控制在 100 词左右）。
                      </li>
                    </ul>
                  ) : (
                    <ul className="list-disc pl-4 space-y-1 text-[#68777C] dark:text-[#9CAEB3]">
                      <li>
                        第一段（图画描摹）：准确描述硕大火锅及其中包含的中西方多元文化元素（京剧、功夫、莎士比亚、芭蕾等）与底部标题“文化火锅既美味又营养”。
                      </li>
                      <li>
                        第二段（象征意义论证）：阐明全球化时代跨文化交融（兼收并蓄、和而不同）的必要性与精神养分。
                      </li>
                      <li>
                        第三段（结论与升华）：提出对中华传统文化保护与外来优秀文化吸收的平衡建议（160–200词）。
                      </li>
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Translation Passage */}
            {currentUnit.unitType === 'translation' &&
              currentUnit.materials.map((mat) => {
                const paras =
                  mat.paragraphs && mat.paragraphs.length > 0
                    ? mat.paragraphs
                    : mat.text.split(/\n{2,}/).filter(Boolean);
                return (
                  <article
                    key={mat.id}
                    style={{
                      fontSize: `${typographyPrefs.fontSizePx}px`,
                      lineHeight: typographyPrefs.lineHeight,
                    }}
                    className="font-english-serif text-[#202B2F] dark:text-[#E2E8E6] space-y-3"
                  >
                    {paras.map((pText, idx) => (
                      <p key={idx} className="leading-relaxed">
                        <span className="font-tabular-mono text-xs text-[#96A1A4] dark:text-[#657980] mr-2">
                          [P{idx + 1}]
                        </span>
                        {renderTextWithSafeUnderline(pText)}
                      </p>
                    ))}
                  </article>
                );
              })}

            {/* Practical Writing Prompt Spec (Q51) */}
            {currentUnit.unitType === 'practical-writing' && (
              <div className="space-y-3 text-xs">
                <div className="p-4 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-xl font-english-serif text-sm text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed">
                  {currentUnit.items[0]?.prompt}
                </div>
                {practicalSpec && (
                  <div className="p-4 bg-white dark:bg-[#1A2529] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2">
                    <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                      应用文审题必含要素核查清单：
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[#68777C] dark:text-[#9CAEB3]">
                      {practicalSpec.requiredPoints.map((pt, i) => (
                        <li key={i}>{pt}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Visual Writing Illustration & Prompt (Q52) */}
            {currentUnit.unitType === 'visual-writing' && visualMat && (
              <div className="space-y-4">
                <CulturalHotpotIllustration
                  visualMaterial={visualMat}
                  allVisualMaterials={visualMats}
                />
              </div>
            )}
          </div>

          {/* Right Column: Subjective Editor, Immutable Version History, Two-Stage Evaluation & Diff */}
          <div className="lg:col-span-6 space-y-5">
            <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-4 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8ECEA] dark:border-[#26373E] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                    主观题作答与不可变版本工作台
                  </h2>
                  <span className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                    每次保存均新增独立版本（V1 原稿 → V2 修改稿 → V3 延时重写），严禁覆盖历史稿件
                  </span>
                </div>
                <div className="text-xs font-tabular-mono text-[#174A5B] dark:text-[#75B6CE]">
                  本稿计时：{formatDuration(subjectiveElapsed)}
                </div>
              </div>

              {currentUnit.unitType === 'translation' ? (
                <div className="space-y-4">
                  {currentUnit.items.map((item) => (
                    <div key={item.id} className="space-y-1.5">
                      <label
                        htmlFor={`trans-input-${item.questionNumber}`}
                        className="block text-xs font-semibold text-[#202B2F] dark:text-[#E2E8E6]"
                      >
                        <span className="font-tabular-mono text-[#174A5B] dark:text-[#75B6CE] mr-1.5">
                          ({item.questionNumber})
                        </span>
                        <span className="font-english-serif font-normal">
                          {item.translationMeta?.underlinedEnglish ||
                            item.prompt}
                        </span>
                      </label>
                      <textarea
                        id={`trans-input-${item.questionNumber}`}
                        rows={2}
                        value={translationInputs[item.questionNumber] || ''}
                        onChange={(e) =>
                          setTranslationInputs((prev) => ({
                            ...prev,
                            [item.questionNumber]: e.target.value,
                          }))
                        }
                        placeholder={`请输入第 (${item.questionNumber}) 句的中文译文...`}
                        className="w-full p-2.5 text-sm bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6] focus:bg-white dark:focus:bg-[#1A2529] focus:border-[#174A5B] dark:focus:border-[#38849E] focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono">
                    <span>
                      当前英文词数：{countEnglishWords(writingDraft)} 词
                    </span>
                    <span>
                      建议词数区间：
                      {currentUnit.unitType === 'practical-writing'
                        ? '90–120 词'
                        : '160–200 词'}
                    </span>
                  </div>
                  <textarea
                    rows={12}
                    aria-label="英文作文输入框"
                    value={writingDraft}
                    onChange={(e) => setWritingDraft(e.target.value)}
                    placeholder="请在此处撰写英文作文（支持多版本保存与两阶段 AI 批改）..."
                    className="w-full p-4 text-sm font-english-serif leading-relaxed bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-xl text-[#202B2F] dark:text-[#E2E8E6] focus:bg-white dark:focus:bg-[#1A2529] focus:border-[#174A5B] dark:focus:border-[#38849E] focus:outline-none"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E8ECEA] dark:border-[#26373E]">
                <button
                  type="button"
                  onClick={() => void handleSaveSubjectiveVersion(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg transition-colors"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>仅保存新版本 (生成 V{unitVersions.length + 1})</span>
                </button>

                {anyModelAvailable ? (
                  <button
                    type="button"
                    disabled={Boolean(evaluatingVersionId)}
                    onClick={() => void handleSaveSubjectiveVersion(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {evaluatingVersionId
                        ? '正在执行两阶段 AI 批改...'
                        : `提交 V${unitVersions.length + 1} 并执行两阶段 AI 批改 (${activeProviderName || 'gemini'})`}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onNavigateSettings}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] bg-stone-100 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg hover:text-[#202B2F] dark:hover:text-[#E2E8E6] transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>需要配置模型（前往设置页配置 API Key）</span>
                  </button>
                )}
              </div>
            </div>

            {/* Immutable Version History & Diff Comparison Panel */}
            {unitVersions.length > 0 && (
              <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8ECEA] dark:border-[#26373E] pb-3">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
                    <h3 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                      历史版本库（共 {unitVersions.length} 稿 · 不可原地覆盖）
                    </h3>
                  </div>
                  {unitVersions.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => setShowDiffPanel((p) => !p)}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] border border-[#174A5B] dark:border-[#38849E] hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white rounded-md transition-colors"
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      <span>
                        {showDiffPanel ? '收起版本对比' : '对比版本差异 (Diff)'}
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {unitVersions.map((ver) => (
                    <button
                      key={ver.id}
                      type="button"
                      onClick={() => setSelectedVersionId(ver.id)}
                      className={`px-3 py-1.5 text-xs font-tabular-mono rounded-md border transition-colors ${
                        selectedVersionId === ver.id
                          ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E] font-semibold'
                          : 'bg-stone-50 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border-[#DCE4E1] dark:border-[#2C3E46]'
                      }`}
                    >
                      {ver.versionLabel} ({ver.wordCount}词)
                    </button>
                  ))}
                </div>

                {/* Version Diff Comparison Box */}
                {showDiffPanel &&
                  selectedVersion &&
                  compareBaseVersion &&
                  versionDiffResult &&
                  unitVersions.length >= 2 && (
                    <div className="p-4 bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                          版本对比：{compareBaseVersion.versionLabel} →{' '}
                          {selectedVersion.versionLabel}（新增{' '}
                          {versionDiffResult.addedCount} 处 / 删除{' '}
                          {versionDiffResult.removedCount} 处）
                        </span>
                        <select
                          aria-label="选择基准对比版本"
                          value={compareBaseVersion.id}
                          onChange={(e) =>
                            setCompareBaseVersionId(e.target.value)
                          }
                          className="px-2 py-1 bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] rounded text-xs text-[#202B2F] dark:text-[#E2E8E6]"
                        >
                          {unitVersions.map((v) => (
                            <option key={v.id} value={v.id}>
                              基准: {v.versionLabel}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="p-3 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] font-english-serif text-sm leading-relaxed text-[#202B2F] dark:text-[#E2E8E6]">
                        {versionDiffResult.segments.map((seg, i) => {
                          if (seg.type === 'added') {
                            return (
                              <span
                                key={i}
                                className="bg-emerald-500/20 text-emerald-800 dark:text-[#4EA387] font-semibold underline px-0.5 rounded"
                              >
                                {seg.text}
                              </span>
                            );
                          }
                          if (seg.type === 'removed') {
                            return (
                              <span
                                key={i}
                                className="bg-rose-500/20 text-rose-800 dark:text-[#CF695E] line-through px-0.5 rounded"
                              >
                                {seg.text}
                              </span>
                            );
                          }
                          return <span key={i}>{seg.text}</span>;
                        })}
                      </div>
                    </div>
                  )}

                {selectedVersion && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono">
                      <span>
                        版本时间：
                        {new Date(selectedVersion.createdAt).toLocaleString(
                          'zh-CN'
                        )}{' '}
                        · 模式：{selectedVersion.practiceMode}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPracticeMode('rewrite');
                            if (
                              currentUnit.unitType === 'translation' &&
                              selectedVersion.subAnswers
                            ) {
                              setTranslationInputs({
                                ...selectedVersion.subAnswers,
                              });
                            } else {
                              setWritingDraft(selectedVersion.content);
                            }
                          }}
                          className="text-[#174A5B] dark:text-[#75B6CE] hover:underline font-sans font-medium"
                        >
                          基于此版本载入编辑器准备重写 →
                        </button>
                        {!selectedEvaluation && anyModelAvailable && (
                          <button
                            type="button"
                            disabled={
                              evaluatingVersionId === selectedVersion.id
                            }
                            onClick={async () => {
                              try {
                                setEvaluatingVersionId(selectedVersion.id);
                                await onRequestSubjectiveEvaluation(
                                  selectedVersion,
                                  currentUnit
                                );
                              } catch (err: any) {
                                setAiErrorBanner(err?.message || 'AI 批改失败');
                              } finally {
                                setEvaluatingVersionId(null);
                              }
                            }}
                            className="px-2.5 py-1 bg-[#174A5B] dark:bg-[#38849E] text-white rounded font-sans font-medium hover:bg-[#123D4B] dark:hover:bg-[#489BB8]"
                          >
                            {evaluatingVersionId === selectedVersion.id
                              ? '批改中...'
                              : '对此版本运行 AI 批改'}
                          </button>
                        )}
                      </div>
                    </div>

                    <pre className="p-3.5 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-xl text-xs font-english-serif whitespace-pre-wrap text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed">
                      {selectedVersion.content}
                    </pre>

                    {/* Two-Stage Subjective Evaluation Report */}
                    {selectedEvaluation && (
                      <div className="border border-[#174A5B] dark:border-[#38849E] bg-stone-50 dark:bg-[#162226] rounded-xl p-4 space-y-4 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-2">
                          <div className="space-y-0.5">
                            <div className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                              两阶段主观题 AI 批改报告（非官方内容 · 仅供学习参考）
                            </div>
                            <div className="text-[11px] text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono">
                              模型：{selectedEvaluation.modelProvider} (
                              {selectedEvaluation.modelName}) · 二阶段复核状态：
                              {selectedEvaluation.reviewerDecision}
                              {selectedEvaluation.reviewerAdjustments
                                ?.stabilityWarning
                                ? ' · 含分差稳定性提示'
                                : ''}
                            </div>
                          </div>
                          <div className="text-right font-tabular-mono">
                            <div className="text-lg font-bold text-[#174A5B] dark:text-[#75B6CE]">
                              参考中心分：{selectedEvaluation.centralScore} /{' '}
                              {selectedEvaluation.maxScore} 分
                            </div>
                            <div className="text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                              建议区间：[{selectedEvaluation.scoreRangeMin},{' '}
                              {selectedEvaluation.scoreRangeMax}] · 置信度：
                              {selectedEvaluation.confidence}
                            </div>
                          </div>
                        </div>

                        {/* Dimension Scores Table */}
                        <div className="overflow-x-auto bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-[#DCE4E1] dark:border-[#2C3E46] bg-stone-100 dark:bg-[#1E2B30] text-[#68777C] dark:text-[#9CAEB3]">
                                <th className="py-2 px-3">评分维度</th>
                                <th className="py-2 px-3">得分</th>
                                <th className="py-2 px-3">诊断反馈</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#DCE4E1] dark:divide-[#2C3E46]">
                              {selectedEvaluation.dimensionScores.map(
                                (d, i) => (
                                  <tr key={i}>
                                    <td className="py-2 px-3 font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                                      {d.name}
                                    </td>
                                    <td className="py-2 px-3 font-tabular-mono text-[#174A5B] dark:text-[#75B6CE]">
                                      {d.score} / {d.maxScore}
                                    </td>
                                    <td className="py-2 px-3 text-[#68777C] dark:text-[#9CAEB3]">
                                      {d.rationale}
                                    </td>
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Quote-Verified Annotations */}
                        {selectedEvaluation.annotations.length > 0 && (
                          <div className="space-y-2">
                            <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                              原文引用校验批注（已通过字符偏移核验）：
                            </div>
                            {selectedEvaluation.annotations.map((ann, idx) => (
                              <div
                                key={idx}
                                className="p-3 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] space-y-1"
                              >
                                <div className="flex items-center justify-between font-tabular-mono text-[11px]">
                                  <span className="text-rose-700 dark:text-[#CF695E] font-semibold">
                                    [{ann.issueType}] 偏移 [{ann.startOffset}:
                                    {ann.endOffset}]
                                  </span>
                                  <span className="text-emerald-700 dark:text-[#4EA387]">
                                    ✓ 原文精确匹配
                                  </span>
                                </div>
                                <div className="font-english-serif text-[#202B2F] dark:text-[#E2E8E6]">
                                  原句摘录：“{ann.quotedUserText}”
                                </div>
                                <div className="text-[#68777C] dark:text-[#9CAEB3]">
                                  诊断：{ann.explanation}
                                </div>
                                <div className="text-emerald-700 dark:text-[#4EA387] font-english-serif">
                                  建议改写：{ann.suggestion}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {selectedEvaluation.visionDegradedToText && (
                          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg text-[11px] text-amber-900 dark:text-amber-200">
                            <span className="font-bold">
                              视觉回退模式说明：
                            </span>
                            <span>
                              当前模型未启用原图视觉直传，已降级为结构化图画要素描述核查，评分置信度相应下调。
                            </span>
                          </div>
                        )}

                        {selectedEvaluation.reviewerAdjustments?.notes?.length > 0 && (
                          <div className="p-2.5 bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                            <span className="font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                              Stage 2 审校结论：
                            </span>{' '}
                            {selectedEvaluation.reviewerAdjustments.notes.join('；')}
                          </div>
                        )}

                        {/* V1 -> V2 -> V3 Revision Verification Table */}
                        {selectedEvaluation.revisionVerification &&
                          selectedEvaluation.revisionVerification.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                                上一版本改进项落实核验（V
                                {Math.max(1, selectedVersion.versionNumber - 1)}{' '}
                                → V{selectedVersion.versionNumber}）：
                              </div>
                              <div className="grid grid-cols-1 gap-1.5">
                                {selectedEvaluation.revisionVerification.map(
                                  (rv, idx) => (
                                    <div
                                      key={idx}
                                      className="p-2.5 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] flex flex-wrap items-start justify-between gap-2"
                                    >
                                      <div className="space-y-0.5">
                                        <div className="font-medium text-[#202B2F] dark:text-[#E2E8E6]">
                                          {rv.instruction}
                                        </div>
                                        <div className="text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                                          核验依据：{rv.evidence}（{rv.explanation}）
                                        </div>
                                      </div>
                                      <span
                                        className={`px-2 py-0.5 rounded text-[11px] font-semibold font-tabular-mono ${
                                          rv.status === 'resolved'
                                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-[#4EA387]'
                                            : rv.status === 'partially-resolved'
                                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                            : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-[#CF695E]'
                                        }`}
                                      >
                                        {rv.status === 'resolved'
                                          ? '✓ 已完成'
                                          : rv.status === 'partially-resolved'
                                          ? '△ 部分落实'
                                          : rv.status === 'regressed'
                                          ? '↓ 发生回退'
                                          : '✗ 未落实'}
                                      </span>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}

                        {/* Executable Revision Tasks */}
                        {selectedEvaluation.revisionTasks.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                              下一次重写（V{selectedVersion.versionNumber + 1}
                              ）可执行改进清单：
                            </div>
                            <ul className="space-y-1">
                              {selectedEvaluation.revisionTasks.map((rt, i) => (
                                <li
                                  key={i}
                                  className="p-2 bg-white dark:bg-[#1A2529] rounded border border-[#DCE4E1] dark:border-[#2C3E46] flex items-start gap-2 text-[#202B2F] dark:text-[#E2E8E6]"
                                >
                                  <span className="font-tabular-mono text-[#174A5B] dark:text-[#75B6CE] font-semibold shrink-0">
                                    [P{rt.priority}]
                                  </span>
                                  <span>{rt.instruction}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Non-Official AI Reference Text */}
                        {selectedEvaluation.referenceContent && (
                          <div className="p-3 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] space-y-1">
                            <div className="font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                              {selectedEvaluation.taskType === 'translation'
                                ? 'AI参考译文（非官方）'
                                : 'AI生成示例（非官方范文）'}{' '}
                              · 仅在提交版本后提供对比参考：
                            </div>
                            <p className="font-english-serif text-xs text-[#202B2F] dark:text-[#E2E8E6] whitespace-pre-wrap leading-relaxed">
                              {selectedEvaluation.referenceContent}
                            </p>
                          </div>
                        )}

                        {/* EvaluationRun Telemetry Footer */}
                        {selectedEvaluation.runId && (
                          <div className="pt-2 border-t border-[#DCE4E1] dark:border-[#2C3E46] flex flex-wrap items-center justify-between gap-2 text-[10px] font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                            <span>
                              Run ID: {selectedEvaluation.runId} · Stage1:{' '}
                              {selectedEvaluation.modelName}
                              {selectedEvaluation.stage2ModelName
                                ? ` · Stage2: ${selectedEvaluation.stage2ModelName}`
                                : ''}
                            </span>
                            <span>
                              耗时: {selectedEvaluation.latencyMs || 0}ms · 缓存:{' '}
                              {selectedEvaluation.cacheStatus || 'miss'} · 重试:{' '}
                              {selectedEvaluation.retryCount || 0}次
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Source-Provided Reference Translations (46-50) or Model Essays (51-52) */}
                    {currentUnit.unitType === 'translation' &&
                      currentUnit.items.some(
                        (it) =>
                          it.translationMeta?.referenceTranslation ||
                          it.rubric?.referenceText
                      ) && (
                        <div className="p-4 bg-emerald-50/50 dark:bg-[#172E27]/60 rounded-xl border border-emerald-200 dark:border-[#2B5446] space-y-2.5 text-xs">
                          <div className="font-bold text-emerald-800 dark:text-[#4EA387] flex items-center justify-between">
                            <span>
                              来源参考译文（46–50题 · 题库收录标准参考答案）
                            </span>
                            <span className="font-tabular-mono text-[11px]">
                              Source: answers/{exam.year}.md
                            </span>
                          </div>
                          <div className="space-y-2">
                            {currentUnit.items.map((it) => {
                              const refT =
                                it.translationMeta?.referenceTranslation ||
                                it.rubric?.referenceText;
                              if (!refT) return null;
                              return (
                                <div
                                  key={it.id}
                                  className="p-2.5 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] space-y-1"
                                >
                                  <div className="font-tabular-mono font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                                    ({it.questionNumber}){' '}
                                    <span className="font-english-serif font-normal text-[#68777C] dark:text-[#9CAEB3]">
                                      {it.translationMeta?.underlinedEnglish}
                                    </span>
                                  </div>
                                  <div className="text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed font-medium">
                                    参考译文：{refT}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    {(currentUnit.unitType === 'practical-writing' ||
                      currentUnit.unitType === 'visual-writing') &&
                      currentUnit.items[0]?.rubric?.referenceText && (
                        <div className="p-4 bg-emerald-50/50 dark:bg-[#172E27]/60 rounded-xl border border-emerald-200 dark:border-[#2B5446] space-y-2 text-xs">
                          <div className="font-bold text-emerald-800 dark:text-[#4EA387] flex items-center justify-between">
                            <span>
                              来源参考范文（第{' '}
                              {currentUnit.items[0].questionNumber} 题 ·
                              题库收录标准参考范文）
                            </span>
                            <span className="font-tabular-mono text-[11px]">
                              Source: answers/{exam.year}.md
                            </span>
                          </div>
                          <pre className="p-3 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] font-english-serif text-xs text-[#202B2F] dark:text-[#E2E8E6] whitespace-pre-wrap leading-relaxed">
                            {currentUnit.items[0].rubric.referenceText}
                          </pre>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            {/* Follow-up Contextual Q&A Box */}
            <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] p-5 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
                  <span>针对当前单元的长难句或语法追问</span>
                </h3>
                {!anyModelAvailable && (
                  <span className="text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                    需要配置模型
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={followUpInput}
                  onChange={(e) => setFollowUpInput(e.target.value)}
                  placeholder="输入你的语法、词汇或审题疑问（不泄露未提交题目的标准答案）..."
                  className="flex-1 px-3 py-1.5 text-xs bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6] focus:bg-white dark:focus:bg-[#1A2529] focus:border-[#174A5B] dark:focus:border-[#38849E] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={
                    !anyModelAvailable ||
                    askingFollowUpQ !== null ||
                    !followUpInput.trim()
                  }
                  onClick={async () => {
                    const qNum = currentUnit.items[0]?.questionNumber || 46;
                    const qText = followUpInput.trim();
                    setFollowUpInput('');
                    try {
                      setAskingFollowUpQ(qNum);
                      const passageText = currentUnit.materials
                        .map((m) => m.text)
                        .join('\n\n');
                      const promptText =
                        currentUnit.items
                          .map(
                            (i) =>
                              i.translationMeta?.underlinedEnglish || i.prompt
                          )
                          .join('\n') || currentUnit.instructions;
                      const userAnswerText =
                        selectedVersion?.content ||
                        writingDraft ||
                        Object.values(translationInputs)
                          .filter(Boolean)
                          .join('\n');
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
                      setFollowUpHistory((prev) => ({
                        ...prev,
                        [qNum]: [
                          ...(prev[qNum] || []),
                          { q: qText, a: reply },
                        ],
                      }));
                    } catch (err: any) {
                      setAiErrorBanner(err?.message || '追问请求失败');
                    } finally {
                      setAskingFollowUpQ(null);
                    }
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-lg disabled:opacity-50 transition-colors"
                >
                  <Send className="w-3 h-3" />
                  <span>
                    {askingFollowUpQ !== null ? '思考中...' : '发送追问'}
                  </span>
                </button>
              </div>
              {(
                followUpHistory[currentUnit.items[0]?.questionNumber || 46] ||
                []
              ).map((entry, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-xs space-y-1"
                >
                  <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                    问：{entry.q}
                  </div>
                  <div className="text-[#68777C] dark:text-[#9CAEB3] whitespace-pre-wrap leading-relaxed">
                    答（AI 助教）：{entry.a}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Accessible Answer Sheet Modal */}
      {showAnswerSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="全卷 1—52 题答题卡"
          className="fixed inset-0 z-50 bg-[#131B1E]/75 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowAnswerSheet(false)}
        >
          <div
            className="bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8ECEA] dark:border-[#26373E] pb-3">
              <h3 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                {exam.year}年 考研英语一 答题卡（1—52 题）
              </h3>
              <button
                type="button"
                aria-label="关闭答题卡"
                onClick={() => setShowAnswerSheet(false)}
                className="p-1 text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {allUnits.map((u) => (
                <div key={u.id} className="space-y-2">
                  <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">{u.title}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {u.items.map((it) => {
                      const q = it.questionNumber;
                      const resp = attempt.objectiveResponses[q];
                      const hasSubj = subjectiveVersions.some(
                        (v) =>
                          v.year === exam.year &&
                          (v.questionNumber === q || v.unitId === u.id)
                      );
                      const isDone = Boolean(resp?.selectedAnswer) || hasSubj;
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            onSelectUnit(u.id);
                            setActiveQuestionNumber(q);
                            setShowAnswerSheet(false);
                          }}
                          className={`w-10 h-9 font-tabular-mono border text-xs rounded-md flex flex-col items-center justify-center transition-colors ${
                            isDone
                              ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E] font-semibold'
                              : 'bg-stone-50 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] border-[#DCE4E1] dark:border-[#2C3E46] hover:bg-stone-100 dark:hover:bg-[#203036]'
                          }`}
                        >
                          <span>{q}</span>
                          {resp?.selectedAnswer && (
                            <span className="text-[10px]">
                              {resp.selectedAnswer}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Submit Attempt Confirmation Modal */}
      {submitConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="确认交卷评分"
          className="fixed inset-0 z-50 bg-[#131B1E]/75 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSubmitConfirmModal(false)}
        >
          <div
            className="bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8ECEA] dark:border-[#26373E] pb-3">
              <h3 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                确认交卷并执行客观题确定性评分
              </h3>
              <button
                type="button"
                aria-label="关闭确认弹窗"
                onClick={() => setSubmitConfirmModal(false)}
              >
                <X className="w-4 h-4 text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]" />
              </button>
            </div>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
              当前已完成客观题：
              <strong className="font-tabular-mono text-[#202B2F] dark:text-[#E2E8E6] mx-1">
                {answeredObjectiveCount} / 45
              </strong>
              题。交卷后将立即核对 1–45 题官方答案、计算客观题得分，并将错题、自信答错题与猜测题自动加入间隔复习队列。
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E8ECEA] dark:border-[#26373E]">
              <button
                type="button"
                onClick={() => setSubmitConfirmModal(false)}
                className="px-4 py-2 text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] hover:bg-stone-100 dark:hover:bg-[#162226] rounded-lg transition-colors"
              >
                继续检查
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubmitConfirmModal(false);
                  onSubmitAttempt();
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-lg transition-colors shadow-xs"
              >
                确认交卷评分
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
