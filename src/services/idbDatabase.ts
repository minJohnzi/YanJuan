import type { LocalLearningDatabase } from './storageAndSync.ts';

const IDB_V2_NAME = 'yanjuan_desk_idb_v2';
const IDB_V2_VERSION = 1;

const LEGACY_IDB_NAME = 'yanjuan_desk_idb_v1';
const LEGACY_STORE_NAME = 'learning_state';
const LEGACY_STORAGE_KEY = 'yanjuan_desk_state_v1';

const STORES = {
  meta: 'meta',
  attempts: 'attempts',
  subjectiveVersions: 'subjective_versions',
  subjectiveEvaluations: 'subjective_evaluations',
  objectiveAnalyses: 'objective_analyses',
  reviewItems: 'review_items',
  conflicts: 'conflicts',
} as const;

interface MetaRecord {
  key: 'root';
  schemaVersion: string;
  deviceId: string;
  isPrivateDevice: boolean;
  preferences: LocalLearningDatabase['preferences'];
  mistakeSummaries?: LocalLearningDatabase['mistakeSummaries'];
  updatedAt: string;
}

function openDatabaseV2(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_V2_NAME, IDB_V2_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.attempts)) {
        db.createObjectStore(STORES.attempts, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.subjectiveVersions)) {
        db.createObjectStore(STORES.subjectiveVersions, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.subjectiveEvaluations)) {
        db.createObjectStore(STORES.subjectiveEvaluations, { keyPath: 'answerVersionId' });
      }
      if (!db.objectStoreNames.contains(STORES.objectiveAnalyses)) {
        db.createObjectStore(STORES.objectiveAnalyses);
      }
      if (!db.objectStoreNames.contains(STORES.reviewItems)) {
        db.createObjectStore(STORES.reviewItems, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.conflicts)) {
        db.createObjectStore(STORES.conflicts, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open yanjuan_desk_idb_v2'));
  });
}

function readAllRecordsAsMap<T>(store: IDBObjectStore): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    const map: Record<string, T> = {};
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve(map);
        return;
      }
      map[String(cursor.key)] = cursor.value as T;
      cursor.continue();
    };
    cursorReq.onerror = () => resolve(map);
  });
}

function readAllArray<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as T[]) : []);
    req.onerror = () => resolve([]);
  });
}

async function readLegacyV1Database(): Promise<LocalLearningDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return await new Promise<LocalLearningDatabase | null>((resolve) => {
      const req = indexedDB.open(LEGACY_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        // Avoid creating empty legacy DB permanently if upgrading cleanly
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          db.createObjectStore(LEGACY_STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          db.close();
          resolve(null);
          return;
        }
        const tx = db.transaction(LEGACY_STORE_NAME, 'readonly');
        const store = tx.objectStore(LEGACY_STORE_NAME);
        const getReq = store.get(LEGACY_STORAGE_KEY);
        getReq.onsuccess = () => {
          const val = (getReq.result as LocalLearningDatabase) || null;
          db.close();
          resolve(val);
        };
        getReq.onerror = () => {
          db.close();
          resolve(null);
        };
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function loadMultiStoreDatabase(): Promise<LocalLearningDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDatabaseV2();
    const storeNames = Object.values(STORES);
    const tx = db.transaction(storeNames, 'readonly');

    const metaReq = tx.objectStore(STORES.meta).get('root');
    const metaPromise = new Promise<MetaRecord | null>((resolve) => {
      metaReq.onsuccess = () => resolve((metaReq.result as MetaRecord) || null);
      metaReq.onerror = () => resolve(null);
    });

    const [
      meta,
      attempts,
      subjectiveVersions,
      subjectiveEvaluations,
      objectiveAnalyses,
      reviewItems,
      conflictRecords,
    ] = await Promise.all([
      metaPromise,
      readAllRecordsAsMap<LocalLearningDatabase['attempts'][string]>(tx.objectStore(STORES.attempts)),
      readAllRecordsAsMap<LocalLearningDatabase['subjectiveVersions'][string]>(
        tx.objectStore(STORES.subjectiveVersions)
      ),
      readAllRecordsAsMap<LocalLearningDatabase['subjectiveEvaluations'][string]>(
        tx.objectStore(STORES.subjectiveEvaluations)
      ),
      readAllRecordsAsMap<LocalLearningDatabase['objectiveAnalyses'][string]>(
        tx.objectStore(STORES.objectiveAnalyses)
      ),
      readAllRecordsAsMap<LocalLearningDatabase['reviewItems'][string]>(
        tx.objectStore(STORES.reviewItems)
      ),
      readAllArray<LocalLearningDatabase['conflictRecords'][number]>(
        tx.objectStore(STORES.conflicts)
      ),
    ]);

    db.close();

    if (meta && meta.schemaVersion) {
      return {
        schemaVersion: meta.schemaVersion,
        deviceId: meta.deviceId,
        isPrivateDevice: meta.isPrivateDevice,
        preferences: meta.preferences,
        attempts,
        subjectiveVersions,
        subjectiveEvaluations,
        objectiveAnalyses,
        reviewItems,
        mistakeSummaries: meta.mistakeSummaries || {},
        conflictRecords,
        updatedAt: meta.updatedAt,
      };
    }

    // Attempt seamless one-time migration from legacy v1 IndexedDB
    const legacyV1 = await readLegacyV1Database();
    if (legacyV1 && legacyV1.schemaVersion) {
      await saveMultiStoreDatabase(legacyV1);
      return legacyV1;
    }

    return null;
  } catch {
    return null;
  }
}

export async function saveMultiStoreDatabase(learningDb: LocalLearningDatabase): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDatabaseV2();
    const storeNames = Object.values(STORES);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(storeNames, 'readwrite');

      const metaStore = tx.objectStore(STORES.meta);
      const metaRecord: MetaRecord = {
        key: 'root',
        schemaVersion: learningDb.schemaVersion,
        deviceId: learningDb.deviceId,
        isPrivateDevice: learningDb.isPrivateDevice,
        preferences: learningDb.preferences,
        mistakeSummaries: learningDb.mistakeSummaries || {},
        updatedAt: learningDb.updatedAt,
      };
      metaStore.put(metaRecord);

      const attemptsStore = tx.objectStore(STORES.attempts);
      attemptsStore.clear();
      for (const att of Object.values(learningDb.attempts)) {
        attemptsStore.put(att);
      }

      const versionsStore = tx.objectStore(STORES.subjectiveVersions);
      versionsStore.clear();
      for (const ver of Object.values(learningDb.subjectiveVersions)) {
        versionsStore.put(ver);
      }

      const evalsStore = tx.objectStore(STORES.subjectiveEvaluations);
      evalsStore.clear();
      for (const [key, ev] of Object.entries(learningDb.subjectiveEvaluations)) {
        evalsStore.put({ ...ev, answerVersionId: ev.answerVersionId || key });
      }

      const analysesStore = tx.objectStore(STORES.objectiveAnalyses);
      analysesStore.clear();
      for (const [key, analysis] of Object.entries(learningDb.objectiveAnalyses)) {
        analysesStore.put(analysis, key);
      }

      const reviewsStore = tx.objectStore(STORES.reviewItems);
      reviewsStore.clear();
      for (const item of Object.values(learningDb.reviewItems)) {
        reviewsStore.put(item);
      }

      const conflictsStore = tx.objectStore(STORES.conflicts);
      conflictsStore.clear();
      for (const conflict of learningDb.conflictRecords || []) {
        conflictsStore.put(conflict);
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Graceful fallback handled by caller
  }
}

export async function clearMultiStoreDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDatabaseV2();
    const storeNames = Object.values(STORES);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // ignore
  }
}
