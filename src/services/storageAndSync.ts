import type {
  ExamAttempt,
  ObjectiveAIAnalysis,
  ReviewItem,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
  SubjectivePracticeMode,
  SyncStatus,
} from '../shared/types.ts';

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

const DB_NAME = 'yanjuan_desk_idb_v1';
const STORE_NAME = 'learning_state';
const STORAGE_KEY = 'yanjuan_desk_state_v1';

export function createDefaultLearningDatabase(deviceId?: string): LocalLearningDatabase {
  return {
    schemaVersion: '1.0.0',
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
 * Creates a new immutable subjective answer version (V1 原稿, V2 修改稿, V3 延时重写...).
 * Strictly forbids overwriting any existing version in db.subjectiveVersions!
 */
export function appendSubjectiveAnswerVersion(
  db: LocalLearningDatabase,
  params: {
    id?: string;
    attemptId: string;
    year: number;
    dataVersion: string;
    unitId: string;
    unitType: 'translation' | 'practical-writing' | 'visual-writing';
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

  const words = params.content
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const nowIso = params.nowIso || new Date().toISOString();

  const createdVersion: SubjectiveAnswerVersion = {
    id: versionId,
    attemptId: params.attemptId,
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
  return mergedDb;
}

/**
 * Browser IndexedDB + localStorage persistence helpers.
 */
export async function loadDatabaseFromBrowser(): Promise<LocalLearningDatabase> {
  if (typeof window === 'undefined') {
    return createDefaultLearningDatabase();
  }

  // Try IndexedDB first
  if (typeof indexedDB !== 'undefined') {
    try {
      const fromIdb = await new Promise<LocalLearningDatabase | null>((resolve) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get(STORAGE_KEY);
          getReq.onsuccess = () => resolve((getReq.result as LocalLearningDatabase) || null);
          getReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      });
      if (fromIdb && fromIdb.schemaVersion) {
        return fromIdb;
      }
    } catch {
      // Fallback to localStorage below
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalLearningDatabase;
      if (parsed && parsed.schemaVersion) return parsed;
    }
  } catch {
    // ignore
  }

  return createDefaultLearningDatabase();
}

export async function saveDatabaseToBrowser(db: LocalLearningDatabase): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore quota errors
  }

  if (typeof indexedDB !== 'undefined') {
    try {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const idb = req.result;
          if (!idb.objectStoreNames.contains(STORE_NAME)) {
            idb.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put(db, STORAGE_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
  }
}

export async function clearBrowserLocalDatabase(): Promise<LocalLearningDatabase> {
  const fresh = createDefaultLearningDatabase();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  await saveDatabaseToBrowser(fresh);
  return fresh;
}
