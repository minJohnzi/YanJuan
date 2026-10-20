import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Library,
  RotateCcw,
  BarChart3,
  Settings,
  Cloud,
  CloudOff,
  Sparkles,
  Sun,
  Moon,
} from 'lucide-react';
import { useTheme, type ThemeMode } from './services/theme';
import type {
  ConfidenceLevel,
  Exam,
  ExamAttempt,
  ExamItem,
  ExamUnit,
  HintRecord,
  ObjectiveItemResponse,
  PapersManifest,
  ProviderCredentialStatus,
  ReviewItem,
  ReviewItemType,
  SubjectiveAnswerVersion,
  SubjectivePracticeMode,
  SyncStatus,
  UnitType,
  ValidationReport,
} from './shared/types';
import {
  DEFAULT_REVIEW_INTERVALS_DAYS,
  buildObjectiveReviewItems,
  buildSubjectiveReviewItems,
  calculateNextReviewSchedule,
  gradeObjectiveResponses,
} from './shared/scoringAndReview';
import {
  LocalLearningDatabase,
  ReadingTypographyPrefs,
  appendSubjectiveAnswerVersion,
  clearBrowserLocalDatabase,
  createDefaultLearningDatabase,
  exportLearningDataJson,
  importLearningDataJson,
  loadDatabaseFromBrowser,
  saveDatabaseToBrowser,
} from './services/storageAndSync';
import {
  isFirebaseConfigured,
  signInWithGooglePopup,
  signOutFirebaseUser,
  subscribeAuthState,
  syncRecordToFirestore,
} from './services/firebaseClient';
import { HomeView } from './components/HomeView';
import { PaperLibraryView } from './components/PaperLibraryView';
import { StudyWorkspaceView } from './components/StudyWorkspaceView';
import { ReviewCenterView } from './components/ReviewCenterView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';

type PrimaryTab = 'home' | 'library' | 'review' | 'stats' | 'settings';

const DEFAULT_MANIFEST: PapersManifest = {
  schemaVersion: '1.0.0',
  buildTime: new Date().toISOString(),
  expectedYears: Array.from({ length: 17 }, (_, i) => 2010 + i),
  availableYears: [],
  failedYears: [2010],
  pendingYears: Array.from({ length: 16 }, (_, i) => 2011 + i),
  latestReadyVersion: {},
  sourceFormats: { '2010': ['md'] },
  unitTypes: {
    '2010': [
      'cloze',
      'reading',
      'passage-assembly',
      'translation',
      'practical-writing',
      'visual-writing',
    ],
  },
  validationStatus: { '2010': 'needs-answer-source' },
  years: Array.from({ length: 17 }, (_, i) => {
    const yr = 2010 + i;
    return {
      year: yr,
      status: yr === 2010 ? 'needs-answer-source' : 'pending',
      latestReadyVersion: null,
      latestCandidateVersion: yr === 2010 ? 'v1' : null,
      availableVersions: yr === 2010 ? ['v1'] : [],
      sourceFormats: yr === 2010 ? ['md'] : [],
      unitTypes:
        yr === 2010
          ? [
              'cloze',
              'reading',
              'passage-assembly',
              'translation',
              'practical-writing',
              'visual-writing',
            ]
          : [],
      validationStatus: yr === 2010 ? 'needs-answer-source' : 'pending',
      errorCodes: yr === 2010 ? ['OBJECTIVE_ANSWER_MISSING'] : [],
      missingObjectiveCount: yr === 2010 ? 45 : 0,
      hasNewerCandidate: yr === 2010,
      updatedAt: new Date().toISOString(),
    };
  }),
};

export default function App() {
  const [activeTab, setActiveTab] = useState<PrimaryTab>('home');
  const [manifest, setManifest] = useState<PapersManifest>(DEFAULT_MANIFEST);
  const [dbState, setDbState] = useState<LocalLearningDatabase>(() =>
    createDefaultLearningDatabase()
  );

  // Sub-views & Active Workspace state
  const [selectedYearOverview, setSelectedYearOverview] =
    useState<Exam | null>(null);
  const [activeReport, setActiveReport] = useState<ValidationReport | null>(
    null
  );
  const [activeCandidateExam, setActiveCandidateExam] = useState<Exam | null>(
    null
  );
  const [workspaceState, setWorkspaceState] = useState<{
    exam: Exam;
    activeUnitId: string;
    attemptId: string;
  } | null>(null);

  // Auth & Cloud Sync state
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    isFirebaseConfigured ? 'saved-local' : 'cloud-unconfigured'
  );

  // Server Model Credentials
  const [credentialStatuses, setCredentialStatuses] = useState<
    ProviderCredentialStatus[]
  >([]);
  const [isImportingAnswers, setIsImportingAnswers] = useState(false);

  const configuredProvider = credentialStatuses.find((c) => c.configured);
  const anyModelAvailable = Boolean(configuredProvider);
  const activeProviderName = configuredProvider?.provider || null;

  // Normalize URL path to / and strip auth token query param
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete('__aistudio_auth_token');
      const search = params.toString();
      const currentPath = window.location.pathname;
      const targetPath =
        !currentPath || currentPath === '/YANJUAN' ? '/' : currentPath;
      const nextUrl = search
        ? targetPath === '/'
          ? `/?${search}`
          : `${targetPath}?${search}`
        : targetPath;
      if (window.location.pathname + window.location.search !== nextUrl) {
        window.history.replaceState(null, '', nextUrl);
      }
    } catch {
      // ignore history errors in restricted environments
    }
  }, []);

  // Load IndexedDB state on boot
  useEffect(() => {
    void (async () => {
      const loaded = await loadDatabaseFromBrowser();
      setDbState(loaded);
    })();
  }, []);

  const updateDb = useCallback(
    (updater: (prev: LocalLearningDatabase) => LocalLearningDatabase) => {
      setDbState((prev) => {
        const next = updater(prev);
        void saveDatabaseToBrowser(next);
        return next;
      });
    },
    []
  );

  const { themeMode, resolvedTheme, setTheme } = useTheme(
    dbState.preferences.themeMode
  );

  const handleSelectThemeMode = useCallback(
    (mode: ThemeMode) => {
      setTheme(mode);
      updateDb((prev) => ({
        ...prev,
        preferences: {
          ...prev.preferences,
          themeMode: mode,
        },
      }));
    },
    [setTheme, updateDb]
  );

  const handleQuickThemeToggle = useCallback(() => {
    const nextMode: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextMode);
    updateDb((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        themeMode: nextMode,
      },
    }));
  }, [resolvedTheme, setTheme, updateDb]);

  // Subscribe Firebase Auth
  useEffect(() => {
    return subscribeAuthState((user) => {
      if (user) {
        setCurrentUserUid(user.uid);
        setCurrentUserEmail(user.email || user.uid);
        setSyncStatus('synced');
      } else {
        setCurrentUserUid(null);
        setCurrentUserEmail(null);
        setSyncStatus(
          isFirebaseConfigured ? 'saved-local' : 'cloud-unconfigured'
        );
      }
    });
  }, []);

  // Fetch Manifest & Provider Credential Statuses
  const refreshManifestAndCapabilities = useCallback(async () => {
    try {
      const [manifestRes, credRes] = await Promise.all([
        fetch('/api/v1/papers-manifest'),
        fetch('/api/v1/provider-credentials'),
      ]);
      if (manifestRes.ok) {
        const body = await manifestRes.json();
        const m = (body.data || body) as PapersManifest;
        if (m && Array.isArray(m.years)) {
          setManifest(m);
        }
      } else {
        const staticRes = await fetch('/data/papers-manifest.json');
        if (staticRes.ok) {
          setManifest((await staticRes.json()) as PapersManifest);
        }
      }
      if (credRes.ok) {
        const cBody = await credRes.json();
        const creds = cBody.data?.credentials || cBody.credentials;
        if (Array.isArray(creds)) {
          setCredentialStatuses(creds);
        }
      }
    } catch {
      try {
        const staticRes = await fetch('/data/papers-manifest.json');
        if (staticRes.ok) {
          setManifest((await staticRes.json()) as PapersManifest);
        }
      } catch {
        // keep default
      }
    }
  }, []);

  useEffect(() => {
    void refreshManifestAndCapabilities();
  }, [refreshManifestAndCapabilities]);

  // Open Import Validation Report & Candidate Structure Inspector
  const handleOpenImportReport = async (year: number, version: string) => {
    try {
      const [repRes, paperRes] = await Promise.all([
        fetch(`/api/v1/import-reports/${year}/${version}`),
        fetch(`/api/v1/papers/${year}/${version}`),
      ]);
      if (repRes.ok) {
        const body = await repRes.json();
        const report = (body.data || body) as ValidationReport;
        setActiveReport(report);
      } else {
        const staticRes = await fetch(
          `/data/import-reports/${year}/${version}.json`
        );
        if (staticRes.ok) {
          setActiveReport((await staticRes.json()) as ValidationReport);
        }
      }

      if (paperRes.ok) {
        const pBody = await paperRes.json();
        setActiveCandidateExam((pBody.data || pBody) as Exam);
      } else {
        const staticPaper = await fetch(`/data/papers/${year}/${version}.json`);
        if (staticPaper.ok) {
          setActiveCandidateExam((await staticPaper.json()) as Exam);
        }
      }

      setSelectedYearOverview(null);
      setWorkspaceState(null);
      setActiveTab('library');
    } catch {
      // ignore
    }
  };

  // Navigate to Settings for External Answer Source Import
  const handleAppend2010OfficialAnswers = async () => {
    setActiveReport(null);
    setSelectedYearOverview(null);
    setWorkspaceState(null);
    setActiveTab('settings');
  };

  // Submit External Paper or Answer Source via POST /api/v1/imports
  const handleSubmitSourceImport = async (params: {
    year: number;
    fileName: string;
    markdownText?: string;
    contentBase64?: string;
  }) => {
    setIsImportingAnswers(true);
    try {
      const res = await fetch('/api/v1/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || '导入失败');
      }
      const newManifest = (body.data?.manifest || body.manifest) as PapersManifest;
      if (newManifest) {
        setManifest(newManifest);
      }
      return body.data?.importJob || body.importJob;
    } finally {
      setIsImportingAnswers(false);
    }
  };

  // Load Exam JSON on-demand per year (directly reads generated JSON without reparsing Markdown)
  const fetchReadyExam = async (year: number): Promise<Exam | null> => {
    try {
      // 1. Try generated runtime exam endpoint or static path
      const genRes = await fetch(`/api/v1/exams/generated/papers/${year}`);
      if (genRes.ok) {
        const body = await genRes.json();
        return (body.data || body) as Exam;
      }
      const staticGen = await fetch(`/data/exams/generated/papers/${year}.json`);
      if (staticGen.ok) {
        return (await staticGen.json()) as Exam;
      }

      // 2. Fallback to versioned paper if present
      const version = manifest.latestReadyVersion[String(year)] || 'v1';
      const res = await fetch(`/api/v1/papers/${year}/${version}`);
      if (res.ok) {
        const body = await res.json();
        return (body.data || body) as Exam;
      }
      const staticRes = await fetch(`/data/papers/${year}/${version}.json`);
      if (staticRes.ok) return (await staticRes.json()) as Exam;
    } catch {
      // ignore
    }
    return null;
  };

  const handleSelectYearOverview = async (year: number) => {
    const exam = await fetchReadyExam(year);
    if (exam) {
      setSelectedYearOverview(exam);
      setActiveReport(null);
      setWorkspaceState(null);
      setActiveTab('library');
    }
  };

  // Start Unit or Full Paper Simulation
  const startExamSession = async (
    year: number,
    mode: 'unit-practice' | 'strict-simulation' | 'free-simulation',
    unitType?: UnitType,
    preferredUnitId?: string
  ) => {
    const exam = await fetchReadyExam(year);
    if (!exam) return;

    const allUnits = exam.sections.flatMap((s) => s.units);
    const targetUnit =
      (preferredUnitId && allUnits.find((u) => u.id === preferredUnitId)) ||
      (unitType && allUnits.find((u) => u.unitType === unitType)) ||
      allUnits[0];

    const existingInProgress = Object.values(dbState.attempts).find(
      (a) =>
        a.year === exam.year &&
        a.dataVersion === exam.dataVersion &&
        a.mode === mode &&
        a.status === 'in-progress'
    );

    const nowIso = new Date().toISOString();
    const attemptId =
      existingInProgress?.id ||
      `attempt-${exam.year}-${exam.dataVersion}-${mode}-${Date.now()}`;

    if (!existingInProgress) {
      const newAttempt: ExamAttempt = {
        id: attemptId,
        year: exam.year,
        dataVersion: exam.dataVersion,
        mode,
        unitIds:
          mode === 'unit-practice'
            ? [targetUnit.id]
            : allUnits.map((u) => u.id),
        status: 'in-progress',
        startedAt: nowIso,
        submittedAt: null,
        updatedAt: nowIso,
        elapsedSeconds: 0,
        remainingSeconds:
          mode === 'unit-practice'
            ? targetUnit.suggestedMinutes * 60
            : exam.durationMinutes * 60,
        objectiveResponses: {},
        subjectiveVersionIds: [],
        deviceId: dbState.deviceId,
        clientRevision: 1,
      };
      updateDb((prev) => ({
        ...prev,
        attempts: {
          ...prev.attempts,
          [attemptId]: newAttempt,
        },
        updatedAt: nowIso,
      }));
    }

    setWorkspaceState({
      exam,
      activeUnitId: targetUnit.id,
      attemptId,
    });
    setActiveReport(null);
    setSelectedYearOverview(null);
  };

  const handleUpdateObjectiveResponse = (
    questionNumber: number,
    patch: Partial<ObjectiveItemResponse>
  ) => {
    if (!workspaceState) return;
    const { attemptId, activeUnitId, exam } = workspaceState;
    const nowIso = new Date().toISOString();

    const currentUnit = exam.sections
      .flatMap((s) => s.units)
      .find((u) => u.id === activeUnitId);
    const item = currentUnit?.items.find(
      (i) => i.questionNumber === questionNumber
    );

    updateDb((prev) => {
      const att = prev.attempts[attemptId];
      if (!att || att.status === 'submitted') return prev;
      const existing: ObjectiveItemResponse = att.objectiveResponses[
        questionNumber
      ] || {
        questionNumber,
        itemId: item?.id || `item-${questionNumber}`,
        unitId: currentUnit?.id || activeUnitId,
        unitType: currentUnit?.unitType || 'reading',
        selectedAnswer: '',
        confidence: 'certain',
        flaggedForReview: false,
        timeSpentSeconds: 0,
        maxScore: item?.score || 2,
        knownErrorCauses: [],
        possibleErrorCauses: [],
        userNotes: '',
        highlights: [],
      };
      const updatedResp: ObjectiveItemResponse = {
        ...existing,
        ...patch,
        questionNumber,
      };
      const nextAtt: ExamAttempt = {
        ...att,
        objectiveResponses: {
          ...att.objectiveResponses,
          [questionNumber]: updatedResp,
        },
        updatedAt: nowIso,
        clientRevision: att.clientRevision + 1,
      };
      return {
        ...prev,
        attempts: {
          ...prev.attempts,
          [attemptId]: nextAtt,
        },
        updatedAt: nowIso,
      };
    });
  };

  const handleTickTimer = useCallback(
    (deltaSeconds: number) => {
      if (!workspaceState) return;
      const { attemptId } = workspaceState;
      updateDb((prev) => {
        const att = prev.attempts[attemptId];
        if (!att || att.status === 'submitted') return prev;
        return {
          ...prev,
          attempts: {
            ...prev.attempts,
            [attemptId]: {
              ...att,
              elapsedSeconds: att.elapsedSeconds + deltaSeconds,
              remainingSeconds: Math.max(
                0,
                (att.remainingSeconds ?? 0) - deltaSeconds
              ),
            },
          },
        };
      });
    },
    [workspaceState, updateDb]
  );

  // Submit Objective Attempt -> Grade & Generate Spaced Repetition Review Items
  const handleSubmitAttempt = () => {
    if (!workspaceState) return;
    const { exam, attemptId } = workspaceState;
    const nowIso = new Date().toISOString();

    updateDb((prev) => {
      const att = prev.attempts[attemptId];
      if (!att) return prev;
      const summary = gradeObjectiveResponses(exam, att.objectiveResponses);
      const generatedReviews = buildObjectiveReviewItems(
        exam,
        summary.itemResults,
        nowIso,
        prev.deviceId
      );

      const nextReviewMap = { ...prev.reviewItems };
      for (const rev of generatedReviews) {
        nextReviewMap[rev.id] = rev;
      }

      const submittedAtt: ExamAttempt = {
        ...att,
        status: 'submitted',
        submittedAt: nowIso,
        updatedAt: nowIso,
        objectiveResponses: summary.itemResults,
        totalObjectiveScore: summary.totalScoreEarned,
        maxObjectiveScore: summary.maxObjectiveScore,
        clientRevision: att.clientRevision + 1,
      };

      if (currentUserUid && isFirebaseConfigured) {
        void syncRecordToFirestore(
          currentUserUid,
          'attempts',
          submittedAtt.id,
          submittedAtt as unknown as Record<string, unknown>
        );
      }

      return {
        ...prev,
        attempts: {
          ...prev.attempts,
          [attemptId]: submittedAtt,
        },
        reviewItems: nextReviewMap,
        updatedAt: nowIso,
      };
    });
  };

  // Save Immutable Subjective Version (V1, V2, V3...)
  const handleSubmitSubjectiveVersion = (params: {
    unitId: string;
    unitType: 'translation' | 'practical-writing' | 'visual-writing';
    questionNumber: number;
    practiceMode: SubjectivePracticeMode;
    content: string;
    subAnswers?: Record<number, string>;
    durationSeconds: number;
    usedHints: HintRecord[];
  }): SubjectiveAnswerVersion => {
    const exam = workspaceState!.exam;
    const attemptId = workspaceState!.attemptId;
    const { updatedDb, createdVersion } = appendSubjectiveAnswerVersion(
      dbState,
      {
        attemptId,
        year: exam.year,
        dataVersion: exam.dataVersion,
        ...params,
      }
    );

    const nowIso = new Date().toISOString();
    const nextDue = new Date(Date.now() + 86400 * 1000).toISOString();
    const baseReview: ReviewItem = {
      id: `rev-subj-draft-${createdVersion.id}`,
      year: exam.year,
      dataVersion: exam.dataVersion,
      unitId: params.unitId,
      unitType: params.unitType,
      questionNumber: params.questionNumber,
      reviewType:
        params.unitType === 'translation' ? 're-translate' : 'revise-essay',
      title: `${exam.year}年 第${params.questionNumber}题 主观题复盘改写 (${createdVersion.versionLabel})`,
      promptSnapshot: params.content.slice(0, 180),
      previousUserAnswer: `${createdVersion.versionLabel} (${createdVersion.wordCount}词)`,
      previousFeedbackSummary: `结合批改清单完成 V${createdVersion.versionNumber + 1} 升格改写`,
      knownErrorCauses: [],
      intervalDays: DEFAULT_REVIEW_INTERVALS_DAYS[0],
      repetitionCount: 0,
      mastered: false,
      nextDueAt: nextDue,
      lastReviewedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      clientRevision: 1,
      deviceId: updatedDb.deviceId,
    };

    const finalDb: LocalLearningDatabase = {
      ...updatedDb,
      reviewItems: {
        ...updatedDb.reviewItems,
        [baseReview.id]: baseReview,
      },
    };

    setDbState(finalDb);
    void saveDatabaseToBrowser(finalDb);
    return createdVersion;
  };

  // Request Two-Stage Subjective AI Evaluation
  const handleRequestSubjectiveEvaluation = async (
    version: SubjectiveAnswerVersion,
    unit: ExamUnit
  ) => {
    const visualMat = unit.materials.find(
      (m) => m.visualMaterials && m.visualMaterials.length > 0
    )?.visualMaterials?.[0];
    const practicalSpec = unit.materials.find(
      (m) => m.practicalWritingSpec
    )?.practicalWritingSpec;

    const res = await fetch('/api/v1/evaluations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `eval-${version.id}`,
      },
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        taskType: version.unitType,
        taskId: unit.id,
        answerVersionId: version.id,
        evaluationMode: 'deep-two-stage',
        usedHints: version.usedHints.length > 0,
        questionPrompt:
          unit.items
            .map((i) => i.translationMeta?.underlinedEnglish || i.prompt)
            .join('\n') || unit.instructions,
        userAnswer: version.content,
        requiredFacts:
          visualMat?.requiredFacts || practicalSpec?.requiredPoints,
        hasVisualMaterial: Boolean(visualMat),
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message || '主观题 AI 批改失败');
    }

    const evaluation = body.data?.evaluation || body.evaluation;
    updateDb((prev) => {
      const targetVer = prev.subjectiveVersions[version.id];
      const aiReviews = buildSubjectiveReviewItems(
        version.year,
        version.dataVersion,
        version.unitId,
        version.questionNumber,
        version.content,
        evaluation,
        new Date().toISOString(),
        prev.deviceId
      );
      const nextReviewMap = { ...prev.reviewItems };
      for (const r of aiReviews) {
        nextReviewMap[r.id] = r;
      }
      return {
        ...prev,
        subjectiveVersions: targetVer
          ? {
              ...prev.subjectiveVersions,
              [version.id]: {
                ...targetVer,
                evaluationId: evaluation.id,
              },
            }
          : prev.subjectiveVersions,
        subjectiveEvaluations: {
          ...prev.subjectiveEvaluations,
          [evaluation.id]: evaluation,
        },
        reviewItems: nextReviewMap,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Request Objective AI Analysis
  const handleRequestObjectiveAnalysis = async (
    item: ExamItem,
    unit: ExamUnit,
    userAnswer: string,
    _confidence: ConfidenceLevel
  ) => {
    const passageText = unit.materials.map((m) => m.text).join('\n\n');

    const res = await fetch('/api/v1/objective-analyses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        questionNumber: item.questionNumber,
        passageText,
        questionPrompt: item.prompt,
        options: item.options || [],
        correctAnswer: item.correctAnswer || 'A',
        userSelectedAnswer: userAnswer,
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message || '客观题 AI 解析请求失败');
    }

    const analysis = body.data?.analysis || body.analysis;
    const key = `${workspaceState?.exam.year || 2010}-q${item.questionNumber}`;
    updateDb((prev) => ({
      ...prev,
      objectiveAnalyses: {
        ...prev.objectiveAnalyses,
        [key]: analysis,
      },
    }));
  };

  // Follow-up Contextual Question
  const handleAskFollowUp = async (params: {
    questionNumber: number;
    questionContext: string;
    userQuestion: string;
    previousAnalysisSummary?: string;
  }): Promise<string> => {
    const res = await fetch('/api/v1/follow-up-analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        questionNumber: params.questionNumber,
        questionContext: params.questionContext,
        userQuestion: params.userQuestion,
        existingAnalysisSummary: params.previousAnalysisSummary,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message || 'AI 追问请求失败');
    }
    return (body.data?.answer || body.answer || '') as string;
  };

  const attemptsList = Object.values(dbState.attempts);
  const subjectiveVersionsList = Object.values(dbState.subjectiveVersions);
  const reviewItemsList = Object.values(dbState.reviewItems);

  return (
    <div className="min-h-screen flex flex-col bg-[#F1F5F3] dark:bg-[#131B1E] text-[#202B2F] dark:text-[#E2E8E6] transition-colors duration-150">
      {/* Top Navigation Bar: Clean Single Row on all viewports */}
      <nav
        aria-label="主导航"
        className="h-14 bg-white/95 dark:bg-[#1A2529]/95 backdrop-blur-xs border-b border-[#DCE4E1] dark:border-[#2C3E46] px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 sticky top-0 z-30 transition-colors"
      >
        <div className="flex items-center gap-3 sm:gap-6 lg:gap-8 min-w-0">
          <button
            type="button"
            onClick={() => {
              setWorkspaceState(null);
              setActiveReport(null);
              setSelectedYearOverview(null);
              setActiveTab('home');
            }}
            className="flex items-center gap-2 text-left shrink-0 group py-1"
          >
            {/* Minimalist square seal / stamp icon */}
            <div className="w-7 h-7 rounded-sm bg-[#174A5B] dark:bg-[#245D72] flex items-center justify-center text-[#FBFAF6] shadow-2xs shrink-0 select-none">
              <span className="font-bold font-sans text-xs">研</span>
            </div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-base font-bold tracking-tight text-[#202B2F] dark:text-[#E2E8E6] group-hover:text-[#174A5B] dark:group-hover:text-[#56AEC8] transition-colors truncate">
                研卷台
              </span>
              <span className="text-xs text-[#96A1A4] dark:text-[#657980] hidden lg:inline font-normal truncate">
                考研英语一真题学习系统
              </span>
            </div>
          </button>

          {/* Desktop/Tablet Primary Navigation Tabs (Hidden on mobile, moved to bottom bar) */}
          <div className="hidden md:flex items-center gap-1 overflow-x-auto">
            {(
              [
                { id: 'home', label: '学习', icon: BookOpen },
                { id: 'library', label: '真题', icon: Library },
                { id: 'review', label: '复习', icon: RotateCcw },
                { id: 'stats', label: '统计', icon: BarChart3 },
              ] as { id: PrimaryTab; label: string; icon: React.FC<any> }[]
            ).map((item) => {
              const Icon = item.icon;
              const isActive = !workspaceState && activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setWorkspaceState(null);
                    setActiveReport(null);
                    setSelectedYearOverview(null);
                    setActiveTab(item.id);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 rounded-md ${
                    isActive
                      ? 'text-[#174A5B] dark:text-[#56AEC8] bg-[#E8F0F1] dark:bg-[#1F3740] font-semibold'
                      : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] hover:bg-stone-100 dark:hover:bg-[#1E2B30]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Controls: Compact status, quick theme toggle & settings */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 text-xs text-[#68777C] dark:text-[#9CAEB3] shrink-0">
          <button
            type="button"
            onClick={() => {
              setWorkspaceState(null);
              setActiveTab('settings');
            }}
            title="点击前往系统与同步设置"
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md bg-stone-50 dark:bg-[#1E2B30] hover:bg-stone-100 dark:hover:bg-[#25363D] border border-[#DCE4E1] dark:border-[#2C3E46] text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] transition-colors whitespace-nowrap text-xs"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isFirebaseConfigured && currentUserUid ? 'bg-[#3F7664] dark:bg-[#4EA387]' : 'bg-[#96A1A4] dark:bg-[#657980]'
              }`}
            />
            <span className="hidden sm:inline">
              {isFirebaseConfigured && currentUserUid ? '已同步' : '本地模式'} · {anyModelAvailable ? 'AI就绪' : 'AI未配置'}
            </span>
            <span className="sm:hidden font-tabular-mono text-[11px]">
              {isFirebaseConfigured && currentUserUid ? '云端' : '本地'}
            </span>
          </button>

          {/* Clean Quick Theme Toggle */}
          <button
            type="button"
            onClick={handleQuickThemeToggle}
            className="p-1.5 rounded-md text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] hover:bg-stone-100 dark:hover:bg-[#1E2B30] transition-colors relative min-w-[36px] min-h-[36px] flex items-center justify-center"
            title={
              resolvedTheme === 'dark'
                ? `深色模式（点击切换浅色 · 设定：${themeMode === 'system' ? '跟随系统' : '深色'}）`
                : `浅色模式（点击切换深色 · 设定：${themeMode === 'system' ? '跟随系统' : '浅色'}）`
            }
            aria-label="切换浅色/深色模式"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-[#C99B5B]" />
            ) : (
              <Moon className="w-4 h-4 text-[#174A5B]" />
            )}
            {themeMode === 'system' && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#174A5B] dark:bg-[#38849E]"
                title="已启用跟随系统设定"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setWorkspaceState(null);
              setActiveTab('settings');
            }}
            className={`p-1.5 rounded-md transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center ${
              !workspaceState && activeTab === 'settings'
                ? 'text-[#174A5B] dark:text-[#56AEC8] bg-[#E8F0F1] dark:bg-[#1F3740]'
                : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] hover:bg-stone-100 dark:hover:bg-[#1E2B30]'
            }`}
            title="设置"
            aria-label="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* Main Content Container with responsive padding */}
      <main
        className={`flex-1 w-full max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 ${
          workspaceState ? 'py-3 sm:py-5' : 'py-5 sm:py-8 pb-24 md:pb-10'
        }`}
      >
        {workspaceState && dbState.attempts[workspaceState.attemptId] ? (
          <StudyWorkspaceView
            exam={workspaceState.exam}
            activeUnitId={workspaceState.activeUnitId}
            attempt={dbState.attempts[workspaceState.attemptId]}
            subjectiveVersions={subjectiveVersionsList}
            subjectiveEvaluations={dbState.subjectiveEvaluations}
            objectiveAnalyses={dbState.objectiveAnalyses}
            anyModelAvailable={anyModelAvailable}
            activeProviderName={activeProviderName}
            typographyPrefs={dbState.preferences}
            onUpdateTypographyPrefs={(prefs: ReadingTypographyPrefs) =>
              updateDb((prev) => ({ ...prev, preferences: prefs }))
            }
            onSelectUnit={(unitId) =>
              setWorkspaceState((prev) =>
                prev ? { ...prev, activeUnitId: unitId } : null
              )
            }
            onUpdateObjectiveResponse={handleUpdateObjectiveResponse}
            onTickTimer={handleTickTimer}
            onSubmitAttempt={handleSubmitAttempt}
            onSubmitSubjectiveVersion={handleSubmitSubjectiveVersion}
            onRequestSubjectiveEvaluation={handleRequestSubjectiveEvaluation}
            onRequestObjectiveAnalysis={handleRequestObjectiveAnalysis}
            onAskFollowUp={handleAskFollowUp}
            onExitWorkspace={() => setWorkspaceState(null)}
            onNavigateSettings={() => {
              setWorkspaceState(null);
              setActiveTab('settings');
            }}
          />
        ) : activeTab === 'home' ? (
          <HomeView
            manifest={manifest}
            attempts={attemptsList}
            subjectiveVersions={subjectiveVersionsList}
            reviewItems={reviewItemsList}
            onStartUnit={(year, unitType, unitId) =>
              void startExamSession(year, 'unit-practice', unitType, unitId)
            }
            onStartSimulation={(year, mode) =>
              void startExamSession(year, mode)
            }
            onOpenImportReport={(year, version) =>
              void handleOpenImportReport(year, version)
            }
            onNavigateTab={(tab) => setActiveTab(tab)}
            onAppend2010OfficialAnswers={handleAppend2010OfficialAnswers}
            isImportingAnswers={isImportingAnswers}
          />
        ) : activeTab === 'library' ? (
          <PaperLibraryView
            manifest={manifest}
            selectedYearOverview={selectedYearOverview}
            activeReport={activeReport}
            activeCandidateExam={activeCandidateExam}
            attempts={attemptsList}
            onSelectYearOverview={(year) => void handleSelectYearOverview(year)}
            onCloseYearOverview={() => setSelectedYearOverview(null)}
            onOpenImportReport={(year, version) =>
              void handleOpenImportReport(year, version)
            }
            onCloseImportReport={() => {
              setActiveReport(null);
              setActiveCandidateExam(null);
            }}
            onStartUnit={(year, unitType, unitId) =>
              void startExamSession(year, 'unit-practice', unitType, unitId)
            }
            onStartSimulation={(year, mode) =>
              void startExamSession(year, mode)
            }
            onAppend2010OfficialAnswers={handleAppend2010OfficialAnswers}
            isImportingAnswers={isImportingAnswers}
            onNavigateSettings={() => {
              setActiveReport(null);
              setActiveTab('settings');
            }}
          />
        ) : activeTab === 'review' ? (
          <ReviewCenterView
            reviewItems={reviewItemsList}
            onCompleteReview={(id, passed) => {
              updateDb((prev) => {
                const target = prev.reviewItems[id];
                if (!target) return prev;
                const updated = calculateNextReviewSchedule(
                  target,
                  passed,
                  passed,
                  prev.preferences.reviewIntervalsDays
                );
                return {
                  ...prev,
                  reviewItems: {
                    ...prev.reviewItems,
                    [id]: updated,
                  },
                };
              });
            }}
            onCreateCustomReviewItem={(params) => {
              updateDb((prev) => {
                const nowIso = new Date().toISOString();
                const nextDue = new Date(
                  Date.now() + 86400 * 1000
                ).toISOString();
                const created: ReviewItem = {
                  id: `rev-custom-${Date.now()}`,
                  year: params.year,
                  dataVersion:
                    manifest.latestReadyVersion[String(params.year)] || 'v2',
                  unitId: 'unit-reading-text-3',
                  unitType: 'reading',
                  questionNumber: params.questionNumber,
                  reviewType: params.reviewType,
                  title: params.title,
                  promptSnapshot: params.promptSnapshot,
                  previousUserAnswer: params.previousUserAnswer,
                  previousFeedbackSummary: params.previousFeedbackSummary,
                  knownErrorCauses: [],
                  intervalDays: DEFAULT_REVIEW_INTERVALS_DAYS[0],
                  repetitionCount: 0,
                  mastered: false,
                  nextDueAt: nextDue,
                  lastReviewedAt: null,
                  createdAt: nowIso,
                  updatedAt: nowIso,
                  clientRevision: 1,
                  deviceId: prev.deviceId,
                };
                return {
                  ...prev,
                  reviewItems: {
                    ...prev.reviewItems,
                    [created.id]: created,
                  },
                };
              });
            }}
            onJumpToUnit={(year, unitType, unitId) =>
              void startExamSession(year, 'unit-practice', unitType, unitId)
            }
          />
        ) : activeTab === 'stats' ? (
          <StatsView
            manifest={manifest}
            attempts={attemptsList}
            subjectiveVersions={subjectiveVersionsList}
            subjectiveEvaluations={dbState.subjectiveEvaluations}
            reviewItems={reviewItemsList}
          />
        ) : (
          <SettingsView
            isFirebaseConfigured={isFirebaseConfigured}
            currentUserEmail={currentUserEmail}
            syncStatus={syncStatus}
            isPrivateDevice={dbState.isPrivateDevice}
            onTogglePrivateDevice={(val) =>
              updateDb((prev) => ({ ...prev, isPrivateDevice: val }))
            }
            onSignInGoogle={async () => {
              await signInWithGooglePopup();
            }}
            onSignOut={async () => {
              await signOutFirebaseUser();
              if (!dbState.isPrivateDevice) {
                const fresh = await clearBrowserLocalDatabase();
                setDbState(fresh);
              }
            }}
            anyModelAvailable={anyModelAvailable}
            activeProviderName={activeProviderName}
            credentialStatuses={credentialStatuses}
            onSaveProviderCredential={async (params) => {
              const res = await fetch('/api/v1/provider-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              const body = await res.json();
              if (!res.ok) {
                throw new Error(body.error?.message || '保存失败');
              }
              await refreshManifestAndCapabilities();
            }}
            onTestProviderCredential={async (params) => {
              const res = await fetch('/api/v1/model-tests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              const body = await res.json();
              if (!res.ok) {
                throw new Error(body.error?.message || '连接测试失败');
              }
              return body.data || body;
            }}
            onDeleteProviderCredential={async (provider) => {
              await fetch(`/api/v1/provider-credentials/${provider}`, {
                method: 'DELETE',
              });
              await refreshManifestAndCapabilities();
            }}
            typographyPrefs={dbState.preferences}
            onUpdateTypographyPrefs={(prefs) =>
              updateDb((prev) => ({ ...prev, preferences: prefs }))
            }
            themeMode={themeMode}
            onSelectThemeMode={handleSelectThemeMode}
            onSubmitSourceImport={handleSubmitSourceImport}
            isImportingAnswers={isImportingAnswers}
            onExportJson={() => exportLearningDataJson(dbState)}
            onImportJson={(raw) => {
              const merged = importLearningDataJson(dbState, raw);
              setDbState(merged);
              void saveDatabaseToBrowser(merged);
            }}
            onClearAllData={async () => {
              const fresh = await clearBrowserLocalDatabase();
              setDbState(fresh);
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (Fixed with Safe Area Support) */}
      {!workspaceState && (
        <nav
          aria-label="移动端底栏导航"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#1A2529]/95 backdrop-blur-md border-t border-[#DCE4E1] dark:border-[#2C3E46] px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] transition-colors shadow-lg"
        >
          <div className="grid grid-cols-4 gap-1 max-w-md mx-auto">
            {(
              [
                { id: 'home', label: '学习', icon: BookOpen },
                { id: 'library', label: '真题', icon: Library },
                { id: 'review', label: '复习', icon: RotateCcw },
                { id: 'stats', label: '统计', icon: BarChart3 },
              ] as { id: PrimaryTab; label: string; icon: React.FC<any> }[]
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveReport(null);
                    setSelectedYearOverview(null);
                    setActiveTab(item.id);
                  }}
                  className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-xs font-medium transition-colors min-h-[48px] ${
                    isActive
                      ? 'text-[#174A5B] dark:text-[#56AEC8] font-bold'
                      : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-0.5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
                  <span className="text-[11px] leading-tight">{item.label}</span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#174A5B] dark:bg-[#56AEC8] mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
