import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen,
  Library,
  RotateCcw,
  BarChart3,
  Settings,
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
  SubjectiveAnswerVersion,
  SubjectivePracticeMode,
  SubjectiveUnitType,
  SystemCapabilitiesResponse,
  UnitType,
  UserAIWorkspaceConfig,
  ValidationReport,
  WritingScaffoldResult,
} from './shared/types';
import {
  formatExamTitle,
  resolveCanonicalPaperId,
  resolveSubjectId,
} from './shared/types';
import {
  DEFAULT_REVIEW_INTERVALS_DAYS,
  buildObjectiveReviewItems,
  buildSubjectiveReviewItems,
  calculateNextReviewSchedule,
  gradeObjectiveResponses,
  sanitizeObjectiveResponsePatch,
} from './shared/scoringAndReview';
import {
  LocalLearningDatabase,
  ReadingTypographyPrefs,
  appendSubjectiveAnswerVersion,
  createDefaultLearningDatabase,
  exportLearningDataJson,
  flushPendingDatabaseSave,
  importLearningDataJson,
  loadDatabaseFromBrowser,
  saveDatabaseToBrowser,
  saveDatabaseToBrowserThrottled,
} from './services/storageAndSync';
import {
  buildLocalApiHeaders,
  fetchSystemCapabilities,
} from './services/localApi';
import { examTimerStore } from './hooks/useTimerStore';
import {
  readUrlNavigationSnapshot,
  useUrlNavigation,
  type UrlNavSnapshot,
} from './hooks/useUrlNavigation';
import { HomeView } from './components/HomeView';
import { AiStatusPopover } from './components/ui/AiStatusPopover';

const PaperLibraryView = lazy(() =>
  import('./components/PaperLibraryView').then((m) => ({
    default: m.PaperLibraryView,
  }))
);
const StudyWorkspaceView = lazy(() =>
  import('./components/StudyWorkspaceView').then((m) => ({
    default: m.StudyWorkspaceView,
  }))
);
const ReviewCenterView = lazy(() =>
  import('./components/ReviewCenterView').then((m) => ({
    default: m.ReviewCenterView,
  }))
);
const StatsView = lazy(() =>
  import('./components/StatsView').then((m) => ({
    default: m.StatsView,
  }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({
    default: m.SettingsView,
  }))
);
const QuickAnswerCheckerModal = lazy(() =>
  import('./components/QuickAnswerCheckerModal').then((m) => ({
    default: m.QuickAnswerCheckerModal,
  }))
);

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
  const initialUrlSnapshotRef = useRef<UrlNavSnapshot>(
    readUrlNavigationSnapshot()
  );
  const [activeTab, setActiveTab] = useState<PrimaryTab>(
    () => initialUrlSnapshotRef.current.tab
  );
  const [dbLoaded, setDbLoaded] = useState(false);
  const [isRestoringUrlPaper, setIsRestoringUrlPaper] = useState(() =>
    Boolean(
      initialUrlSnapshotRef.current.paperYear ||
        initialUrlSnapshotRef.current.attemptId
    )
  );
  const didRestoreUrlPaperRef = useRef(false);
  const skipNextUrlPushRef = useRef(false);
  const lastSyncedRouteKeyRef = useRef('');
  const startExamSessionRef = useRef<
    ((
      year: number,
      mode: 'unit-practice' | 'strict-simulation' | 'free-simulation',
      unitType?: UnitType,
      preferredUnitId?: string,
      options?: { forceNew?: boolean; focusQuestion?: number | null }
    ) => Promise<void>) | null
  >(null);
  const openAttemptByIdRef = useRef<
    ((
      attemptId: string,
      preferredUnitId?: string,
      focusQuestion?: number | null
    ) => Promise<boolean>) | null
  >(null);

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
    initialFocusQuestion?: number | null;
  } | null>(null);
  const [quickCheckerExam, setQuickCheckerExam] = useState<Exam | null>(null);

  // Local-First System Capabilities
  const [systemCapabilities, setSystemCapabilities] =
    useState<SystemCapabilitiesResponse | null>(null);

  // Server Model Credentials & 4-Layer AI Workspace
  const [credentialStatuses, setCredentialStatuses] = useState<
    ProviderCredentialStatus[]
  >([]);
  const [aiWorkspace, setAiWorkspace] = useState<UserAIWorkspaceConfig | null>(
    null
  );
  const [isImportingAnswers] = useState(false);

  const activeDefaultProfile =
    aiWorkspace?.modelProfiles.find(
      (p) => p.id === aiWorkspace.defaultModelProfileId
    ) ||
    aiWorkspace?.modelProfiles[0] ||
    null;
  const activeConnection = activeDefaultProfile
    ? aiWorkspace?.connections.find(
        (c) => c.id === activeDefaultProfile.connectionId
      )
    : null;
  const configuredProvider = credentialStatuses.find((c) => c.configured);
  const anyModelAvailable =
    Boolean(activeDefaultProfile && activeConnection?.enabled) ||
    Boolean(configuredProvider);
  const activeProviderName =
    activeConnection?.providerType || configuredProvider?.provider || null;
  const activeModelSummary = activeDefaultProfile
    ? `${activeConnection?.providerType || 'provider'} / ${activeDefaultProfile.modelId}`
    : configuredProvider?.model
    ? `${configuredProvider.provider} / ${configuredProvider.model}`
    : activeProviderName;

  const handlePopState = useCallback((snapshot: UrlNavSnapshot) => {
    skipNextUrlPushRef.current = true;
    setActiveReport(null);
    setSelectedYearOverview(null);
    setActiveTab(snapshot.tab);
    if (snapshot.attemptId) {
      void (async () => {
        const opened = await openAttemptByIdRef.current?.(
          snapshot.attemptId!,
          snapshot.unitId || undefined,
          snapshot.questionNumber || undefined
        );
        if (!opened && snapshot.paperYear) {
          const m =
            snapshot.mode === 'strict-simulation' ||
            snapshot.mode === 'free-simulation' ||
            snapshot.mode === 'unit-practice'
              ? snapshot.mode
              : 'unit-practice';
          await startExamSessionRef.current?.(
            snapshot.paperYear,
            m,
            undefined,
            snapshot.unitId || undefined,
            { focusQuestion: snapshot.questionNumber || undefined }
          );
        }
      })();
      return;
    }
    if (snapshot.paperYear) {
      const m =
        snapshot.mode === 'strict-simulation' ||
        snapshot.mode === 'free-simulation' ||
        snapshot.mode === 'unit-practice'
          ? snapshot.mode
          : 'unit-practice';
      void startExamSessionRef.current?.(
        snapshot.paperYear,
        m,
        undefined,
        snapshot.unitId || undefined,
        { focusQuestion: snapshot.questionNumber || undefined }
      );
    } else {
      setWorkspaceState(null);
    }
  }, []);

  const { syncUrl } = useUrlNavigation(handlePopState);

  // Load IndexedDB state on boot
  useEffect(() => {
    void (async () => {
      try {
        const loaded = await loadDatabaseFromBrowser();
        setDbState(loaded);
      } finally {
        setDbLoaded(true);
      }
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

  // Register throttled timer persistence outside React tick loop
  useEffect(() => {
    examTimerStore.setPersistCallback((attemptId, elapsedSeconds) => {
      setDbState((prev) => {
        const att = prev.attempts[attemptId];
        if (!att || att.status === 'submitted') return prev;
        const delta = Math.max(0, elapsedSeconds - att.elapsedSeconds);
        const next: LocalLearningDatabase = {
          ...prev,
          attempts: {
            ...prev.attempts,
            [attemptId]: {
              ...att,
              elapsedSeconds,
              remainingSeconds: Math.max(
                0,
                (att.remainingSeconds ?? 0) - delta
              ),
            },
          },
        };
        saveDatabaseToBrowserThrottled(next);
        return next;
      });
    });
    return () => {
      examTimerStore.setPersistCallback(null);
    };
  }, []);

  // Fetch Manifest, Provider Credential Statuses, Capabilities & 4-Layer AI Workspace
  const refreshManifestAndCapabilities = useCallback(async () => {
    try {
      const authHeaders = buildLocalApiHeaders();
      const [manifestRes, credRes, caps] = await Promise.all([
        fetch('/api/v1/papers-manifest'),
        fetch('/api/v1/provider-credentials', { headers: authHeaders }),
        fetchSystemCapabilities(),
      ]);
      if (caps) {
        setSystemCapabilities(caps);
      }
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
        const ws = cBody.data?.workspace || cBody.workspace;
        if (ws && Array.isArray(ws.connections)) {
          setAiWorkspace(ws as UserAIWorkspaceConfig);
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

  // Navigate to Settings
  const handleAppend2010OfficialAnswers = async () => {
    setActiveReport(null);
    setSelectedYearOverview(null);
    setWorkspaceState(null);
    setActiveTab('settings');
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

  // Quick Answer Checker for paper/offline attempts
  const handleOpenQuickChecker = async (year: number) => {
    const exam = await fetchReadyExam(year);
    if (exam) {
      setQuickCheckerExam(exam);
    }
  };

  const handleApplyQuickCheck = (
    responses: Record<number, ObjectiveItemResponse>
  ) => {
    if (!quickCheckerExam) return;
    const exam = quickCheckerExam;
    const canGrade = exam.answerSourceStatus !== 'unavailable';
    const scoring = canGrade ? gradeObjectiveResponses(exam, responses) : null;
    const nowIso = new Date().toISOString();
    const mode = 'free-simulation';
    const allUnits = exam.sections.flatMap((s) => s.units);

    const attemptId = `attempt-${exam.year}-${exam.dataVersion}-paper-check-${Date.now()}`;
    const paperId = resolveCanonicalPaperId(exam.year, exam.paperId);
    const subjectId = resolveSubjectId(exam.year, exam.subjectId);
    const newAttempt: ExamAttempt = {
      id: attemptId,
      paperId,
      subjectId,
      year: exam.year,
      dataVersion: exam.dataVersion,
      mode,
      unitIds: allUnits.map((u) => u.id),
      status: 'submitted',
      startedAt: nowIso,
      submittedAt: nowIso,
      updatedAt: nowIso,
      elapsedSeconds: 0,
      remainingSeconds: 0,
      objectiveResponses: scoring ? scoring.itemResults : responses,
      totalObjectiveScore: scoring?.totalScoreEarned,
      maxObjectiveScore: scoring?.maxObjectiveScore,
      subjectiveVersionIds: [],
      clientRevision: 1,
      deviceId: dbState.deviceId,
    };

    const newReviewItems = scoring
      ? buildObjectiveReviewItems(
          exam,
          scoring.itemResults,
          { attemptId, nowIso },
          dbState.deviceId
        )
      : [];
    const updatedReviewMap = { ...dbState.reviewItems };
    for (const rItem of newReviewItems) {
      updatedReviewMap[rItem.id] = rItem;
    }

    const updatedDb: LocalLearningDatabase = {
      ...dbState,
      attempts: {
        ...dbState.attempts,
        [attemptId]: newAttempt,
      },
      reviewItems: updatedReviewMap,
      updatedAt: nowIso,
    };

    setDbState(updatedDb);
    saveDatabaseToBrowser(updatedDb);

    // Non-blocking server attempt registration outside React state updater
    void (async () => {
      try {
        const headers = buildLocalApiHeaders({
          'Content-Type': 'application/json',
        });
        await fetch(`/api/v1/exams/${exam.paperId || exam.year}/submit-attempt`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ attemptId: newAttempt.id, attempt: newAttempt }),
        });
      } catch {
        // non-blocking server attempt registration
      }
    })();

    setWorkspaceState({
      exam,
      activeUnitId: allUnits[0].id,
      attemptId,
    });
    setQuickCheckerExam(null);
  };

  // Start Unit or Full Paper Simulation
  const startExamSession = async (
    year: number,
    mode: 'unit-practice' | 'strict-simulation' | 'free-simulation',
    unitType?: UnitType,
    preferredUnitId?: string,
    options?: { forceNew?: boolean; focusQuestion?: number | null }
  ) => {
    const exam = await fetchReadyExam(year);
    if (!exam) return;

    const allUnits = exam.sections.flatMap((s) => s.units);
    const targetUnit =
      (preferredUnitId && allUnits.find((u) => u.id === preferredUnitId)) ||
      (unitType && allUnits.find((u) => u.unitType === unitType)) ||
      allUnits[0];

    const existingInProgress = options?.forceNew
      ? undefined
      : Object.values(dbState.attempts).find(
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
      const paperId = resolveCanonicalPaperId(exam.year, exam.paperId);
      const subjectId = resolveSubjectId(exam.year, exam.subjectId);
      const newAttempt: ExamAttempt = {
        id: attemptId,
        paperId,
        subjectId,
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
    } else if (mode === 'unit-practice') {
      const nextUnitIds = [
        targetUnit.id,
        ...(existingInProgress.unitIds || []).filter((id) => id !== targetUnit.id),
      ];
      updateDb((prev) => {
        const current = prev.attempts[existingInProgress.id];
        if (!current) return prev;
        return {
          ...prev,
          attempts: {
            ...prev.attempts,
            [existingInProgress.id]: {
              ...current,
              unitIds: nextUnitIds,
              updatedAt: nowIso,
              clientRevision: current.clientRevision + 1,
            },
          },
          updatedAt: nowIso,
        };
      });
    }

    setWorkspaceState({
      exam,
      activeUnitId: targetUnit.id,
      attemptId,
      initialFocusQuestion: options?.focusQuestion ?? null,
    });
    setActiveReport(null);
    setSelectedYearOverview(null);
  };

  // Reopen an existing attempt (e.g., submitted historical paper or mistake-linked attempt)
  const openAttemptById = async (
    attemptId: string,
    preferredUnitId?: string,
    focusQuestion?: number | null
  ): Promise<boolean> => {
    const targetAttempt = dbState.attempts[attemptId];
    if (!targetAttempt) return false;
    const exam = await fetchReadyExam(targetAttempt.year);
    if (!exam) return false;

    const allUnits = exam.sections.flatMap((s) => s.units);
    let targetUnit =
      (preferredUnitId && allUnits.find((u) => u.id === preferredUnitId)) ||
      undefined;
    if (!targetUnit && focusQuestion) {
      targetUnit = allUnits.find((u) =>
        u.items.some((it) => it.questionNumber === focusQuestion)
      );
    }
    if (!targetUnit && targetAttempt.unitIds?.length) {
      targetUnit = allUnits.find((u) => u.id === targetAttempt.unitIds[0]);
    }
    if (!targetUnit) {
      targetUnit = allUnits[0];
    }

    setWorkspaceState({
      exam,
      activeUnitId: targetUnit.id,
      attemptId: targetAttempt.id,
      initialFocusQuestion: focusQuestion ?? null,
    });
    setActiveReport(null);
    setSelectedYearOverview(null);
    return true;
  };

  startExamSessionRef.current = startExamSession;
  openAttemptByIdRef.current = openAttemptById;

  // Restore deep-linked paper session once IndexedDB finishes loading
  useEffect(() => {
    if (!dbLoaded || didRestoreUrlPaperRef.current) return;
    didRestoreUrlPaperRef.current = true;
    const snap = initialUrlSnapshotRef.current;
    if (!snap.paperYear && !snap.attemptId) return;

    void (async () => {
      try {
        if (snap.attemptId) {
          const opened = await openAttemptById(
            snap.attemptId,
            snap.unitId || undefined,
            snap.questionNumber ?? null
          );
          if (opened) return;
        }
        if (snap.paperYear) {
          const restoredMode =
            snap.mode === 'strict-simulation' ||
            snap.mode === 'free-simulation' ||
            snap.mode === 'unit-practice'
              ? snap.mode
              : 'unit-practice';
          await startExamSession(
            snap.paperYear,
            restoredMode,
            undefined,
            snap.unitId || undefined,
            { focusQuestion: snap.questionNumber ?? null }
          );
        }
      } finally {
        setIsRestoringUrlPaper(false);
      }
    })();
  }, [dbLoaded]);

  // Keep URL query parameters synchronized with active tab & workspace session
  useEffect(() => {
    if (!dbLoaded || isRestoringUrlPaper) return;
    const paperYear = workspaceState?.exam.year ?? null;
    const unitId = workspaceState?.activeUnitId ?? null;
    const attemptId = workspaceState?.attemptId ?? null;
    const questionNumber = workspaceState?.initialFocusQuestion ?? null;
    const mode = workspaceState
      ? dbState.attempts[workspaceState.attemptId]?.mode || null
      : null;
    const routeKey = `${activeTab}|${paperYear || ''}|${attemptId || ''}|${mode || ''}`;
    const isInitialSync = lastSyncedRouteKeyRef.current === '';
    const shouldReplace =
      isInitialSync ||
      skipNextUrlPushRef.current ||
      lastSyncedRouteKeyRef.current === routeKey;
    skipNextUrlPushRef.current = false;
    lastSyncedRouteKeyRef.current = routeKey;
    syncUrl(
      {
        tab: activeTab,
        paperYear,
        unitId,
        mode,
        attemptId,
        questionNumber,
      },
      shouldReplace
    );
  }, [dbLoaded, isRestoringUrlPaper, activeTab, workspaceState, dbState.attempts, syncUrl]);

  const handleUpdateObjectiveResponse = (
    questionNumber: number,
    patch: Partial<ObjectiveItemResponse>
  ) => {
    if (!workspaceState) return;
    const { attemptId, activeUnitId, exam } = workspaceState;
    const nowIso = new Date().toISOString();

    const allUnits = exam.sections.flatMap((s) => s.units);
    const matchedUnit =
      allUnits.find((u) =>
        u.items.some((i) => i.questionNumber === questionNumber)
      ) || allUnits.find((u) => u.id === activeUnitId);
    const item = matchedUnit?.items.find(
      (i) => i.questionNumber === questionNumber
    );

    updateDb((prev) => {
      const att = prev.attempts[attemptId];
      if (!att) return prev;
      const safePatch = sanitizeObjectiveResponsePatch(att.status, patch);
      if (att.status === 'submitted' && Object.keys(safePatch).length === 0) {
        return prev;
      }
      const existing: ObjectiveItemResponse = att.objectiveResponses[
        questionNumber
      ] || {
        questionNumber,
        itemId: item?.id || `item-${questionNumber}`,
        unitId: matchedUnit?.id || activeUnitId,
        unitType: matchedUnit?.unitType || 'reading',
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
        ...safePatch,
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

  // Submit Objective Attempt -> Grade & Generate Spaced Repetition Review Items
  const handleSubmitAttempt = () => {
    if (!workspaceState) return;
    const { exam, attemptId } = workspaceState;
    const nowIso = new Date().toISOString();
    examTimerStore.setPaused(true);

    const baseAtt = dbState.attempts[attemptId];
    if (!baseAtt) return;
    const finalElapsed = examTimerStore.getElapsedForAttempt(
      attemptId,
      baseAtt.elapsedSeconds
    );
    const canGrade = exam.answerSourceStatus !== 'unavailable';
    const summary = canGrade
      ? gradeObjectiveResponses(exam, baseAtt.objectiveResponses)
      : null;
    const generatedReviews = summary
      ? buildObjectiveReviewItems(
          exam,
          summary.itemResults,
          { attemptId, nowIso },
          dbState.deviceId
        )
      : [];

    const submittedAtt: ExamAttempt = {
      ...baseAtt,
      paperId: resolveCanonicalPaperId(exam.year, baseAtt.paperId || exam.paperId),
      subjectId: resolveSubjectId(exam.year, baseAtt.subjectId || exam.subjectId),
      status: 'submitted',
      submittedAt: nowIso,
      updatedAt: nowIso,
      elapsedSeconds: finalElapsed,
      objectiveResponses: summary ? summary.itemResults : baseAtt.objectiveResponses,
      totalObjectiveScore: summary?.totalScoreEarned,
      maxObjectiveScore: summary?.maxObjectiveScore,
      clientRevision: baseAtt.clientRevision + 1,
    };

    updateDb((prev) => {
      const nextReviewMap = { ...prev.reviewItems };
      for (const rev of generatedReviews) {
        nextReviewMap[rev.id] = rev;
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

    void flushPendingDatabaseSave();

    // Non-blocking server attempt registration outside React state updater
    void (async () => {
      try {
        const headers = buildLocalApiHeaders({
          'Content-Type': 'application/json',
        });
        await fetch(`/api/v1/exams/${exam.paperId || exam.year}/submit-attempt`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ attemptId: submittedAtt.id, attempt: submittedAtt }),
        });
      } catch {
        // non-blocking server attempt registration
      }
    })();
  };

  // Save Immutable Subjective Version (V1, V2, V3...)
  const handleSubmitSubjectiveVersion = (params: {
    unitId: string;
    unitType: SubjectiveUnitType;
    questionNumber: number;
    practiceMode: SubjectivePracticeMode;
    content: string;
    subAnswers?: Record<number, string>;
    durationSeconds: number;
    usedHints: HintRecord[];
  }): SubjectiveAnswerVersion => {
    const exam = workspaceState!.exam;
    const attemptId = workspaceState!.attemptId;
    const paperId = resolveCanonicalPaperId(exam.year, exam.paperId);
    const subjectId = resolveSubjectId(exam.year, exam.subjectId);
    const { updatedDb, createdVersion } = appendSubjectiveAnswerVersion(
      dbState,
      {
        attemptId,
        paperId,
        subjectId,
        year: exam.year,
        dataVersion: exam.dataVersion,
        ...params,
      }
    );

    const nowIso = new Date().toISOString();
    const nextDue = new Date(Date.now() + 86400 * 1000).toISOString();
    const unitLabel = params.unitType === 'politics-analysis' ? '字' : '词';
    const baseReview: ReviewItem = {
      id: `rev-subj-draft-${createdVersion.id}`,
      paperId,
      subjectId,
      year: exam.year,
      dataVersion: exam.dataVersion,
      unitId: params.unitId,
      unitType: params.unitType,
      questionNumber: params.questionNumber,
      reviewType:
        params.unitType === 'translation'
          ? 're-translate'
          : params.unitType === 'politics-analysis'
          ? 're-analyze-politics'
          : 'revise-essay',
      title: `${formatExamTitle(exam.year, 'short')} 第${params.questionNumber}题 主观题复盘改写 (${createdVersion.versionLabel})`,
      promptSnapshot: params.content.slice(0, 180),
      previousUserAnswer: `${createdVersion.versionLabel} (${createdVersion.wordCount}${unitLabel})`,
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
    const visualMats = unit.materials.flatMap(
      (m) => m.visualMaterials || []
    );
    const visualMat = visualMats[0];
    const practicalSpec = unit.materials.find(
      (m) => m.practicalWritingSpec
    )?.practicalWritingSpec;
    const imagePaths = visualMats
      .map((vm) => vm.imagePath)
      .filter((u): u is string => Boolean(u));
    const targetItem =
      unit.items.find((it) => it.questionNumber === version.questionNumber) ||
      unit.items[0];
    const rubric = targetItem?.rubric || unit.items[0]?.rubric;

    const itemMaterialParagraphs =
      unit.materials.find((m) =>
        targetItem && m.relatedItemIds?.includes(targetItem.id)
      )?.paragraphs ||
      (Array.isArray((targetItem as any)?.materials)
        ? ((targetItem as any).materials as string[])
        : []);
    const materialText =
      itemMaterialParagraphs.length > 0
        ? itemMaterialParagraphs.join('\n\n')
        : undefined;
    const referenceText =
      targetItem?.answerKeyPoints ||
      targetItem?.rubric?.referenceText ||
      targetItem?.officialExplanation ||
      rubric?.referenceText;

    // Look up immediately preceding version and its evaluation for V1 -> V2 -> V3 revision verification
    let previousAnswerVersionId: string | undefined;
    let previousVersionLabel: string | undefined;
    let previousUserAnswer: string | undefined;
    let previousEvaluation: any | undefined;
    if (version.versionNumber > 1) {
      const prevVer = Object.values(dbState.subjectiveVersions).find(
        (v) =>
          v.year === version.year &&
          v.unitId === version.unitId &&
          v.questionNumber === version.questionNumber &&
          v.versionNumber === version.versionNumber - 1
      );
      if (prevVer) {
        previousAnswerVersionId = prevVer.id;
        previousVersionLabel = prevVer.versionLabel;
        previousUserAnswer = prevVer.content;
        previousEvaluation = prevVer.evaluationId
          ? dbState.subjectiveEvaluations[prevVer.evaluationId]
          : Object.values(dbState.subjectiveEvaluations).find(
              (ev) => ev.answerVersionId === prevVer.id
            );
      }
    }

    const headers = buildLocalApiHeaders({
      'Content-Type': 'application/json',
    });

    const questionPrompt =
      version.unitType === 'politics-analysis'
        ? targetItem?.subQuestions?.join('\n') ||
          targetItem?.prompt ||
          unit.instructions
        : unit.items
            .map((i) => i.translationMeta?.underlinedEnglish || i.prompt)
            .join('\n') || unit.instructions;

    const res = await fetch('/api/v1/evaluations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        year: version.paperId || version.year,
        taskType: version.unitType,
        taskId:
          version.unitType === 'politics-analysis'
            ? `${unit.id}-q${version.questionNumber}`
            : unit.id,
        answerVersionId: version.id,
        previousAnswerVersionId,
        previousVersionLabel,
        previousUserAnswer,
        previousEvaluation,
        evaluationMode: 'deep-two-stage',
        usedHints: version.usedHints.length > 0,
        questionPrompt,
        userAnswer: version.content,
        maxScore: targetItem?.score,
        requiredFacts:
          visualMat?.requiredFacts || practicalSpec?.requiredPoints,
        hasVisualMaterial: Boolean(visualMat),
        imagePaths,
        materialText,
        referenceText,
        rubric,
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
    const headers = buildLocalApiHeaders({
      'Content-Type': 'application/json',
    });

    const res = await fetch('/api/v1/objective-analyses', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        year: workspaceState?.exam.paperId || workspaceState?.exam.year,
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
    unitId?: string;
    unitTitle?: string;
    passageText?: string;
    promptText?: string;
    userAnswer?: string;
    isSubmitted?: boolean;
  }): Promise<string> => {
    const headers = buildLocalApiHeaders({
      'Content-Type': 'application/json',
    });
    const activeAttempt = workspaceState
      ? dbState.attempts[workspaceState.attemptId]
      : undefined;
    const followUpMode =
      activeAttempt?.mode === 'strict-simulation' ? 'exam' : 'study';

    const res = await fetch('/api/v1/follow-up-analyses', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        year: workspaceState?.exam.paperId || workspaceState?.exam.year,
        attemptId: workspaceState?.attemptId,
        mode: followUpMode,
        unitId: params.unitId,
        unitTitle: params.unitTitle || params.questionContext,
        questionNumber: params.questionNumber,
        questionContext: params.questionContext,
        passageText: params.passageText,
        promptText: params.promptText,
        userAnswer: params.userAnswer,
        isSubmitted: params.isSubmitted,
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

  // Request AI Writing Scaffold
  const handleRequestWritingScaffold = async (params: {
    unitType: 'translation' | 'practical-writing' | 'visual-writing';
    promptText: string;
    requiredFacts?: string[];
  }): Promise<WritingScaffoldResult> => {
    const headers = buildLocalApiHeaders({
      'Content-Type': 'application/json',
    });
    const res = await fetch('/api/v1/writing-scaffolds', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: activeProviderName || 'gemini',
        unitId: workspaceState?.activeUnitId || 'unit-writing',
        questionNumber: params.unitType === 'practical-writing' ? 51 : 52,
        questionPrompt: params.promptText,
        requiredFacts: params.requiredFacts,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message || '生成结构支架失败');
    }
    return (body.data?.scaffold || body.scaffold) as WritingScaffoldResult;
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
              if (workspaceState) {
                examTimerStore.flushPersist();
                void flushPendingDatabaseSave();
              }
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
                考研公共课真题与冲刺研习系统
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
                    if (workspaceState) {
                      examTimerStore.flushPersist();
                      void flushPendingDatabaseSave();
                    }
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
          <AiStatusPopover
            systemCapabilities={systemCapabilities}
            anyModelAvailable={anyModelAvailable}
            activeModelSummary={activeModelSummary || activeProviderName}
            aiWorkspace={aiWorkspace}
            onRefreshWorkspace={refreshManifestAndCapabilities}
            onNavigateSettings={() => {
              if (workspaceState) {
                examTimerStore.flushPersist();
                void flushPendingDatabaseSave();
              }
              setWorkspaceState(null);
              setActiveTab('settings');
            }}
          />

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
              if (workspaceState) {
                examTimerStore.flushPersist();
                void flushPendingDatabaseSave();
              }
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
        <Suspense
          fallback={
            <div className="py-12 text-center text-xs text-secondary">
              正在加载视图模块...
            </div>
          }
        >
        {workspaceState && dbState.attempts[workspaceState.attemptId] ? (
          <StudyWorkspaceView
            exam={workspaceState.exam}
            activeUnitId={workspaceState.activeUnitId}
            initialFocusQuestion={workspaceState.initialFocusQuestion ?? null}
            attempt={dbState.attempts[workspaceState.attemptId]}
            subjectiveVersions={subjectiveVersionsList}
            subjectiveEvaluations={dbState.subjectiveEvaluations}
            objectiveAnalyses={dbState.objectiveAnalyses}
            anyModelAvailable={anyModelAvailable}
            activeProviderName={activeModelSummary || activeProviderName}
            typographyPrefs={dbState.preferences}
            onUpdateTypographyPrefs={(prefs: ReadingTypographyPrefs) =>
              updateDb((prev) => ({ ...prev, preferences: prefs }))
            }
            onSelectUnit={(unitId) => {
              const activeAttId = workspaceState?.attemptId;
              if (activeAttId) {
                const nowIso = new Date().toISOString();
                updateDb((prev) => {
                  const current = prev.attempts[activeAttId];
                  if (!current || current.mode !== 'unit-practice') return prev;
                  const nextUnitIds = [
                    unitId,
                    ...(current.unitIds || []).filter((id) => id !== unitId),
                  ];
                  return {
                    ...prev,
                    attempts: {
                      ...prev.attempts,
                      [activeAttId]: {
                        ...current,
                        unitIds: nextUnitIds,
                        updatedAt: nowIso,
                        clientRevision: current.clientRevision + 1,
                      },
                    },
                    updatedAt: nowIso,
                  };
                });
              }
              setWorkspaceState((prev) =>
                prev
                  ? { ...prev, activeUnitId: unitId, initialFocusQuestion: null }
                  : null
              );
            }}
            onRestartFreshPaper={() => {
              const currentMode =
                dbState.attempts[workspaceState.attemptId]?.mode || 'unit-practice';
              void startExamSession(
                workspaceState.exam.year,
                currentMode,
                undefined,
                workspaceState.activeUnitId,
                { forceNew: true }
              );
            }}
            onUpdateObjectiveResponse={handleUpdateObjectiveResponse}
            onSubmitAttempt={handleSubmitAttempt}
            onSubmitSubjectiveVersion={handleSubmitSubjectiveVersion}
            onRequestSubjectiveEvaluation={handleRequestSubjectiveEvaluation}
            onRequestObjectiveAnalysis={handleRequestObjectiveAnalysis}
            onAskFollowUp={handleAskFollowUp}
            onRequestWritingScaffold={handleRequestWritingScaffold}
            onExitWorkspace={() => {
              examTimerStore.flushPersist();
              void flushPendingDatabaseSave();
              setWorkspaceState(null);
            }}
            onNavigateSettings={() => {
              examTimerStore.flushPersist();
              void flushPendingDatabaseSave();
              setWorkspaceState(null);
              setActiveTab('settings');
            }}
            onOpenQuickChecker={() => setQuickCheckerExam(workspaceState.exam)}
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
            onStartFresh={(year, unitType, unitId) =>
              void startExamSession(year, 'unit-practice', unitType, unitId, {
                forceNew: true,
              })
            }
            onOpenAttempt={(attemptId, preferredUnitId, focusQuestion) =>
              void openAttemptById(attemptId, preferredUnitId, focusQuestion)
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
            onOpenQuickChecker={handleOpenQuickChecker}
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
            onStartFresh={(year, unitType, unitId) =>
              void startExamSession(year, 'unit-practice', unitType, unitId, {
                forceNew: true,
              })
            }
            onOpenAttempt={(attemptId, preferredUnitId, focusQuestion) =>
              void openAttemptById(attemptId, preferredUnitId, focusQuestion)
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
            onOpenQuickChecker={handleOpenQuickChecker}
          />
        ) : activeTab === 'review' ? (
          <ReviewCenterView
            reviewItems={reviewItemsList}
            attempts={attemptsList}
            onOpenAttempt={(attemptId, unitId, questionNumber) =>
              void openAttemptById(attemptId, unitId, questionNumber)
            }
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
                const paperId = resolveCanonicalPaperId(params.year);
                const subjectId = resolveSubjectId(params.year);
                const isPolitics = subjectId === 'politics';
                const unitMapping = ((): {
                  unitId: string;
                  unitType: ReviewItem['unitType'];
                } => {
                  if (params.reviewType === 're-analyze-politics' || isPolitics) {
                    if (isPolitics && params.reviewType !== 're-analyze-politics') {
                      if (params.questionNumber >= 17 && params.questionNumber <= 33) {
                        return {
                          unitId: `${params.year}-unit-politics-multi`,
                          unitType: 'politics-multi',
                        };
                      }
                      if (params.questionNumber >= 1 && params.questionNumber <= 16) {
                        return {
                          unitId: `${params.year}-unit-politics-single`,
                          unitType: 'politics-single',
                        };
                      }
                    }
                    return {
                      unitId: `${params.year}-unit-politics-analysis`,
                      unitType: 'politics-analysis',
                    };
                  }
                  if (params.reviewType === 're-translate') {
                    return {
                      unitId: `${params.year}-unit-translation`,
                      unitType: 'translation',
                    };
                  }
                  if (params.reviewType === 'revise-essay') {
                    return params.questionNumber === 52
                      ? {
                          unitId: `${params.year}-unit-visual-writing`,
                          unitType: 'visual-writing',
                        }
                      : {
                          unitId: `${params.year}-unit-practical-writing`,
                          unitType: 'practical-writing',
                        };
                  }
                  if (params.questionNumber >= 1 && params.questionNumber <= 20) {
                    return {
                      unitId: `${params.year}-unit-cloze`,
                      unitType: 'cloze',
                    };
                  }
                  if (params.questionNumber >= 21 && params.questionNumber <= 25) {
                    return {
                      unitId: `${params.year}-unit-reading-1`,
                      unitType: 'reading',
                    };
                  }
                  if (params.questionNumber >= 26 && params.questionNumber <= 30) {
                    return {
                      unitId: `${params.year}-unit-reading-2`,
                      unitType: 'reading',
                    };
                  }
                  if (params.questionNumber >= 31 && params.questionNumber <= 35) {
                    return {
                      unitId: `${params.year}-unit-reading-3`,
                      unitType: 'reading',
                    };
                  }
                  if (params.questionNumber >= 36 && params.questionNumber <= 40) {
                    return {
                      unitId: `${params.year}-unit-reading-4`,
                      unitType: 'reading',
                    };
                  }
                  if (params.questionNumber >= 41 && params.questionNumber <= 45) {
                    return {
                      unitId: `${params.year}-unit-part-b`,
                      unitType: 'passage-assembly',
                    };
                  }
                  return {
                    unitId: `${params.year}-unit-reading-3`,
                    unitType: 'reading',
                  };
                })();
                const created: ReviewItem = {
                  id: `rev-custom-${Date.now()}`,
                  paperId,
                  subjectId,
                  year: params.year,
                  dataVersion:
                    manifest.latestReadyVersion[String(params.year)] || 'v2',
                  unitId: unitMapping.unitId,
                  unitType: unitMapping.unitType,
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
            onJumpToUnit={(year, unitType, unitId, questionNumber) =>
              void startExamSession(year, 'unit-practice', unitType, unitId, {
                focusQuestion: questionNumber ?? null,
              })
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
            systemCapabilities={systemCapabilities}
            onRefreshCapabilities={refreshManifestAndCapabilities}
            anyModelAvailable={anyModelAvailable}
            activeProviderName={activeModelSummary || activeProviderName}
            credentialStatuses={credentialStatuses}
            aiWorkspace={aiWorkspace}
            onRefreshWorkspace={refreshManifestAndCapabilities}
            onSaveProviderCredential={async (params) => {
              const headers = buildLocalApiHeaders({
                'Content-Type': 'application/json',
              });
              const res = await fetch('/api/v1/provider-credentials', {
                method: 'POST',
                headers,
                body: JSON.stringify(params),
              });
              const body = await res.json();
              if (!res.ok) {
                throw new Error(body.error?.message || '保存失败');
              }
              await refreshManifestAndCapabilities();
            }}
            onTestProviderCredential={async (params) => {
              const headers = buildLocalApiHeaders({
                'Content-Type': 'application/json',
              });
              const res = await fetch('/api/v1/model-tests', {
                method: 'POST',
                headers,
                body: JSON.stringify(params),
              });
              const body = await res.json();
              if (!res.ok) {
                throw new Error(body.error?.message || '连接测试失败');
              }
              return body.data || body;
            }}
            onDeleteProviderCredential={async (provider) => {
              const headers = buildLocalApiHeaders();
              const res = await fetch(`/api/v1/provider-credentials/${provider}`, {
                method: 'DELETE',
                headers,
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error?.message || '删除失败');
              }
              await refreshManifestAndCapabilities();
            }}
            typographyPrefs={dbState.preferences}
            onUpdateTypographyPrefs={(prefs) =>
              updateDb((prev) => ({ ...prev, preferences: prefs }))
            }
            themeMode={themeMode}
            onSelectThemeMode={handleSelectThemeMode}
            onExportJson={() => exportLearningDataJson(dbState)}
            onImportJson={(raw) => {
              const merged = importLearningDataJson(dbState, raw);
              setDbState(merged);
              void saveDatabaseToBrowser(merged);
            }}
          />
        )}
        </Suspense>
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

      {quickCheckerExam && (
        <Suspense fallback={null}>
          <QuickAnswerCheckerModal
            isOpen={Boolean(quickCheckerExam)}
            onClose={() => setQuickCheckerExam(null)}
            exam={quickCheckerExam}
            onConfirmApply={handleApplyQuickCheck}
            initialResponses={
              workspaceState && workspaceState.exam.year === quickCheckerExam.year
                ? dbState.attempts[workspaceState.attemptId]?.objectiveResponses
                : undefined
            }
          />
        </Suspense>
      )}
    </div>
  );
}
