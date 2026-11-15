import type {
  ExamAttempt,
  ObjectiveAIAnalysis,
  ReviewItem,
  SubjectId,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
  SubjectivePracticeMode,
  SubjectiveUnitType,
  SyncStatus,
} from '../shared/types.ts';
import { resolveCanonicalPaperId, resolveSubjectId } from '../domain/subjects.ts';
import {
  clearMultiStoreDatabase,
  loadMultiStoreDatabase,
  saveMultiStoreDatabase,
} from './idbDatabase.ts';

import type { ThemeMode } from './theme.ts';

export type { ThemeMode };

export interface ReadingTypographyPrefs {
  fontSizePx: number; // default 18
  lineHeight: number; // default 1.8
  measureCh: number; // default 72 (within 65-78)
  reviewIntervalsDays: number[]; // default [1, 3, 7, 14, 30]
  themeMode?: ThemeMode; // 'light' | 'dark' | 'system'
}

export interface LocalLearningDatabase {
  schemaVersion: string;
  deviceId: string;
  isPrivateDevice: boolean;
  preferences: ReadingTypographyPrefs;
  attempts: Record<string, ExamAttempt>;
  subjectiveVersions: Record<string, SubjectiveAnswerVersion>;
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  objectiveAnalyses: Record<string, ObjectiveAIAnalysis>;
  reviewItems: Record<string, ReviewItem>;
  conflictRecords: {
    id: string;
    attemptId: string;
    localRevision: number;
    remoteRevision: number;
    localDeviceId: string;
    remoteDeviceId: string;
    detectedAt: string;
    resolved: boolean;
  }[];
  updatedAt: string;
}

const STORAGE_KEY = 'yanjuan_desk_state_v1';

export function createDefaultLearningDatabase(deviceId?: string): LocalLearningDatabase {
  return {
    schemaVersion: '2.0.0',
    deviceId: deviceId || `dev-${Math.random().toString(36).slice(2, 10)}`,
    isPrivateDevice: true,
    preferences: {
      fontSizePx: 18,
      lineHeight: 1.8,
      measureCh: 72,
      reviewIntervalsDays: [1, 3, 7, 14, 30],
      themeMode: 'system',
    },
    attempts: {},
    subjectiveVersions: {},
    subjectiveEvaluations: {},
    objectiveAnalyses: {},
    reviewItems: {},
    conflictRecords: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Migrates legacy numeric-year records to include canonical `paperId` and `subjectId`
 * without altering immutable answer contents or breaking existing fields.
 */
export function migrateDatabasePaperIds(
  db: LocalLearningDatabase
): LocalLearningDatabase {
  let changed = false;

  const attempts: LocalLearningDatabase['attempts'] = {};
  for (const [id, att] of Object.entries(db.attempts || {})) {
    const paperId = resolveCanonicalPaperId(att.year, att.paperId);
    const subjectId = resolveSubjectId(att.year, att.subjectId);
    if (att.paperId !== paperId || att.subjectId !== subjectId) {
      attempts[id] = { ...att, paperId, subjectId };
      changed = true;
    } else {
      attempts[id] = att;
    }
  }

  const subjectiveVersions: LocalLearningDatabase['subjectiveVersions'] = {};
  for (const [id, ver] of Object.entries(db.subjectiveVersions || {})) {
    const paperId = resolveCanonicalPaperId(ver.year, ver.paperId);
    const subjectId = resolveSubjectId(ver.year, ver.subjectId);
    if (ver.paperId !== paperId || ver.subjectId !== subjectId) {
      subjectiveVersions[id] = { ...ver, paperId, subjectId };
      changed = true;
    } else {
      subjectiveVersions[id] = ver;
    }
  }

  const objectiveAnalyses: LocalLearningDatabase['objectiveAnalyses'] = {};
  for (const [id, analysis] of Object.entries(db.objectiveAnalyses || {})) {
    const yearGuess = analysis.year;
    if (yearGuess && (!analysis.paperId || !analysis.subjectId)) {
      objectiveAnalyses[id] = {
        ...analysis,
        paperId: resolveCanonicalPaperId(yearGuess, analysis.paperId),
        subjectId: resolveSubjectId(yearGuess, analysis.subjectId),
      };
      changed = true;
    } else {
      objectiveAnalyses[id] = analysis;
    }
  }

  const reviewItems: LocalLearningDatabase['reviewItems'] = {};
  for (const [id, rev] of Object.entries(db.reviewItems || {})) {
    const paperId = resolveCanonicalPaperId(rev.year, rev.paperId);
    const subjectId = resolveSubjectId(rev.year, rev.subjectId);
    if (rev.paperId !== paperId || rev.subjectId !== subjectId) {
      reviewItems[id] = { ...rev, paperId, subjectId };
      changed = true;
    } else {
      reviewItems[id] = rev;
    }
  }

  if (!changed && db.schemaVersion === '2.0.0') {
    return db;
  }

  return {
    ...db,
    schemaVersion: '2.0.0',
    attempts,
    subjectiveVersions,
    objectiveAnalyses,
    reviewItems,
  };
}

/**
 * Creates a new immutable subjective answer version (V1 原稿, V2 修改稿, V3 延时重写...).
 * Strictly forbids overwriting any existing version in db.subjectiveVersions!
 */
export function appendSubjectiveAnswerVersion(
  db: LocalLearningDatabase,
  params: {
    id?: string;
    attemptId: string;
    paperId?: string;
    subjectId?: SubjectId;
    year: number;
    dataVersion: string;
    unitId: string;
    unitType: SubjectiveUnitType;
    questionNumber: number;
    practiceMode: SubjectivePracticeMode;
    content: string;
    subAnswers?: Record<number, string>;
    durationSeconds: number;
    usedHints: SubjectiveAnswerVersion['usedHints'];
    nowIso?: string;
  }
): { updatedDb: LocalLearningDatabase; createdVersion: SubjectiveAnswerVersion } {
  const existingForQuestion = Object.values(db.subjectiveVersions)
    .filter(
      (v) =>
        v.year === params.year &&
        v.dataVersion === params.dataVersion &&
        v.questionNumber === params.questionNumber
    )
    .sort((a, b) => a.versionNumber - b.versionNumber);

  const nextVersionNumber =
    existingForQuestion.length > 0
      ? existingForQuestion[existingForQuestion.length - 1].versionNumber + 1
      : 1;

  const parentVersion =
    existingForQuestion.length > 0
      ? existingForQuestion[existingForQuestion.length - 1]
      : null;

  const versionId =
    params.id ||
    `ver-${params.year}-${params.dataVersion}-q${params.questionNumber}-v${nextVersionNumber}-${Date.now()}`;

  if (db.subjectiveVersions[versionId]) {
    throw new Error(
      `IMMUTABLE_VERSION_OVERWRITE_FORBIDDEN: 禁止原地覆盖已存在的主观题版本 (${versionId})`
    );
  }

  const labelMap: Record<number, string> = {
    1: 'V1 原稿',
    2: 'V2 修改稿',
    3: 'V3 延时重写',
  };
  const versionLabel = labelMap[nextVersionNumber] || `V${nextVersionNumber} 进阶重写`;

  const paperId = resolveCanonicalPaperId(params.year, params.paperId);
  const subjectId = resolveSubjectId(params.year, params.subjectId);

  const words =
    params.unitType === 'politics-analysis'
      ? params.content.replace(/\s+/g, '').length
      : params.content
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
  const nowIso = params.nowIso || new Date().toISOString();

  const createdVersion: SubjectiveAnswerVersion = {
    id: versionId,
    attemptId: params.attemptId,
    paperId,
    subjectId,
    year: params.year,
    dataVersion: params.dataVersion,
    unitId: params.unitId,
    unitType: params.unitType,
    questionNumber: params.questionNumber,
    versionNumber: nextVersionNumber,
    versionLabel,
    practiceMode: params.practiceMode,
    content: params.content,
    subAnswers: params.subAnswers,
    wordCount: words,
    durationSeconds: params.durationSeconds,
    usedHints: params.usedHints || [],
    parentVersionId: parentVersion ? parentVersion.id : null,
    evaluationId: null,
    createdAt: nowIso,
    deviceId: db.deviceId,
    clientRevision: nextVersionNumber,
  };

  const nextDb: LocalLearningDatabase = {
    ...db,
    subjectiveVersions: {
      ...db.subjectiveVersions,
      [versionId]: createdVersion,
    },
    updatedAt: nowIso,
  };

  return { updatedDb: nextDb, createdVersion };
}

/**
 * Merges remote or imported learning data into local database with multi-device conflict detection.
 * - Subjective answer versions are strictly append-only (never overwritten).
 * - Objective attempts from different devices with diverging revisions record a conflict entry.
 */
export function mergeLearningDatabasesWithConflictDetection(
  localDb: LocalLearningDatabase,
  remoteDb: Partial<LocalLearningDatabase>
): {
  mergedDb: LocalLearningDatabase;
  hasConflict: boolean;
  syncStatus: SyncStatus;
} {
  const nextDb: LocalLearningDatabase = structuredClone(localDb);
  let hasConflict = false;

  // 1. Subjective versions: strictly additive (never overwrite existing version id)
  if (remoteDb.subjectiveVersions) {
    for (const [verId, remoteVer] of Object.entries(remoteDb.subjectiveVersions)) {
      if (!nextDb.subjectiveVersions[verId]) {
        nextDb.subjectiveVersions[verId] = remoteVer;
      }
    }
  }

  // 2. Subjective evaluations: additive
  if (remoteDb.subjectiveEvaluations) {
    for (const [evalId, remoteEval] of Object.entries(remoteDb.subjectiveEvaluations)) {
      nextDb.subjectiveEvaluations[evalId] = remoteEval;
    }
  }

  // 3. Attempts: check deviceId, clientRevision, and updatedAt
  if (remoteDb.attempts) {
    for (const [attId, remoteAtt] of Object.entries(remoteDb.attempts)) {
      const localAtt = nextDb.attempts[attId];
      if (!localAtt) {
        nextDb.attempts[attId] = remoteAtt;
        continue;
      }

      if (
        localAtt.deviceId !== remoteAtt.deviceId &&
        localAtt.updatedAt !== remoteAtt.updatedAt &&
        JSON.stringify(localAtt.objectiveResponses) !==
          JSON.stringify(remoteAtt.objectiveResponses)
      ) {
        hasConflict = true;
        nextDb.conflictRecords.push({
          id: `conflict-${attId}-${Date.now()}`,
          attemptId: attId,
          localRevision: localAtt.clientRevision,
          remoteRevision: remoteAtt.clientRevision,
          localDeviceId: localAtt.deviceId,
          remoteDeviceId: remoteAtt.deviceId,
          detectedAt: new Date().toISOString(),
          resolved: false,
        });
        // Preserve the one with higher clientRevision or newer updatedAt while keeping conflict log
        if (
          remoteAtt.clientRevision > localAtt.clientRevision ||
          new Date(remoteAtt.updatedAt).getTime() > new Date(localAtt.updatedAt).getTime()
        ) {
          nextDb.attempts[attId] = {
            ...remoteAtt,
            objectiveResponses: {
              ...localAtt.objectiveResponses,
              ...remoteAtt.objectiveResponses,
            },
          };
        }
      } else if (remoteAtt.clientRevision > localAtt.clientRevision) {
        nextDb.attempts[attId] = remoteAtt;
      }
    }
  }

  // 4. Review items: keep latest updatedAt
  if (remoteDb.reviewItems) {
    for (const [revId, remoteRev] of Object.entries(remoteDb.reviewItems)) {
      const localRev = nextDb.reviewItems[revId];
      if (
        !localRev ||
        new Date(remoteRev.updatedAt).getTime() >= new Date(localRev.updatedAt).getTime()
      ) {
        nextDb.reviewItems[revId] = remoteRev;
      }
    }
  }

  nextDb.updatedAt = new Date().toISOString();

  return {
    mergedDb: nextDb,
    hasConflict,
    syncStatus: hasConflict ? 'conflict' : 'synced',
  };
}

/**
 * Exports the entire learning database to a verified JSON string.
 */
export function exportLearningDataJson(db: LocalLearningDatabase): string {
  return JSON.stringify(
    {
      exportMagic: 'YANJUAN_DESK_EXPORT_V1',
      exportedAt: new Date().toISOString(),
      database: db,
    },
    null,
    2
  );
}

/**
 * Validates and imports a JSON export file into the current database without overwriting immutable versions.
 */
export function importLearningDataJson(
  currentDb: LocalLearningDatabase,
  rawJson: string
): LocalLearningDatabase {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('INVALID_EXPORT_JSON: 导入文件不是合法的 JSON 格式');
  }
  const incomingDb: Partial<LocalLearningDatabase> =
    parsed?.exportMagic === 'YANJUAN_DESK_EXPORT_V1' ? parsed.database : parsed;

  if (!incomingDb || typeof incomingDb !== 'object') {
    throw new Error('INVALID_EXPORT_SCHEMA: 导入文件缺少有效的学习数据结构');
  }

  const { mergedDb } = mergeLearningDatabasesWithConflictDetection(
    currentDb,
    incomingDb
  );
  return migrateDatabasePaperIds(mergedDb);
}

/**
 * Browser IndexedDB v2 + localStorage persistence helpers with throttled buffered writes.
 */
let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDbToFlush: LocalLearningDatabase | null = null;
let unloadListenersRegistered = false;

function ensureUnloadListeners(): void {
  if (unloadListenersRegistered || typeof window === 'undefined') return;
  unloadListenersRegistered = true;

  const flushSyncOrAsync = () => {
    void flushPendingDatabaseSave();
  };

  window.addEventListener('pagehide', flushSyncOrAsync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSyncOrAsync();
    }
  });
}

export async function flushPendingDatabaseSave(): Promise<void> {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (!pendingDbToFlush) return;
  const snapshot = pendingDbToFlush;
  pendingDbToFlush = null;
  await saveDatabaseToBrowser(snapshot);
}

export function saveDatabaseToBrowserThrottled(
  db: LocalLearningDatabase,
  delayMs = 2500
): void {
  if (typeof window === 'undefined') return;
  ensureUnloadListeners();
  pendingDbToFlush = db;
  if (pendingSaveTimer) return;
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    void flushPendingDatabaseSave();
  }, delayMs);
}

export async function loadDatabaseFromBrowser(): Promise<LocalLearningDatabase> {
  if (typeof window === 'undefined') {
    return createDefaultLearningDatabase();
  }

  const fromIdb = await loadMultiStoreDatabase();
  if (fromIdb && fromIdb.schemaVersion) {
    return migrateDatabasePaperIds(fromIdb);
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalLearningDatabase;
      if (parsed && parsed.schemaVersion) {
        const migrated = migrateDatabasePaperIds(parsed);
        await saveMultiStoreDatabase(migrated);
        return migrated;
      }
    }
  } catch {
    // ignore
  }

  return createDefaultLearningDatabase();
}

export async function saveDatabaseToBrowser(db: LocalLearningDatabase): Promise<void> {
  if (typeof window === 'undefined') return;
  pendingDbToFlush = null;
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore quota errors
  }

  await saveMultiStoreDatabase(db);
}

export async function clearBrowserLocalDatabase(): Promise<LocalLearningDatabase> {
  pendingDbToFlush = null;
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  const fresh = createDefaultLearningDatabase();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  await clearMultiStoreDatabase();
  await saveDatabaseToBrowser(fresh);
  return fresh;
}
