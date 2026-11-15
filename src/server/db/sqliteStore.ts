import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EvaluationRun,
  ModelProfile,
  ProviderConnection,
  UserAIWorkspaceConfig,
} from '../../domain/ai.ts';
import type {
  AttemptSubmissionRecord,
  StoredIdempotencyEntry,
} from '../persistentStore.ts';
import type { EncryptedCredentialRecord } from '../securityAndCrypto.ts';

interface LegacyDiskStoreSchema {
  schemaVersion?: number;
  updatedAt?: string;
  credentials?: Record<string, EncryptedCredentialRecord>;
  workspaces?: Record<string, UserAIWorkspaceConfig>;
  evaluationRuns?: Record<string, EvaluationRun>;
  submissions?: Record<string, AttemptSubmissionRecord>;
  idempotencyRecords?: Record<string, StoredIdempotencyEntry>;
}

/**
 * ACID SQLite backing store powered by Node 24's built-in `node:sqlite` (`DatabaseSync`).
 * Enables WAL mode + 5s busy timeout and automatically migrates legacy JSON store files on first open.
 */
export class SqliteBackingStore {
  public readonly dbPath: string;
  public readonly isMemory: boolean;
  public readonly migratedFromLegacyJson: boolean;
  private readonly db: DatabaseSync;

  constructor(storePathOrMemory?: string) {
    if (storePathOrMemory === ':memory:') {
      this.isMemory = true;
      this.dbPath = ':memory:';
      this.migratedFromLegacyJson = false;
      this.db = new DatabaseSync(':memory:');
      this.initSchema();
      return;
    }

    const defaultDbPath = path.join(process.cwd(), 'data', 'runtime', 'yanjuan.db');
    let resolvedPath = storePathOrMemory || defaultDbPath;
    let legacyJsonPath: string | null = null;

    if (resolvedPath.toLowerCase().endsWith('.json')) {
      legacyJsonPath = resolvedPath;
      resolvedPath = `${resolvedPath.slice(0, -5)}.sqlite`;
    } else if (!storePathOrMemory) {
      legacyJsonPath = path.join(path.dirname(defaultDbPath), 'ai-workspace-store.json');
    }

    this.isMemory = false;
    this.dbPath = resolvedPath;
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    this.db = new DatabaseSync(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.initSchema();

    this.migratedFromLegacyJson = legacyJsonPath
      ? this.migrateLegacyJsonIfNeeded(legacyJsonPath)
      : false;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS credentials (
        cred_key TEXT PRIMARY KEY,
        owner_uid TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_credentials_owner ON credentials (owner_uid);

      CREATE TABLE IF NOT EXISTS workspaces (
        owner_uid TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_connections (
        id TEXT PRIMARY KEY,
        owner_uid TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        storage_mode TEXT NOT NULL,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_connections_owner ON provider_connections (owner_uid);

      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        owner_uid TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_owner ON model_profiles (owner_uid);

      CREATE TABLE IF NOT EXISTS evaluation_runs (
        run_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        run_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runs_user ON evaluation_runs (user_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS attempt_submissions (
        submission_key TEXT PRIMARY KEY,
        owner_uid TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        paper_year INTEGER NOT NULL,
        paper_id TEXT,
        record_json TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_submissions_owner_year ON attempt_submissions (owner_uid, paper_year);

      CREATE TABLE IF NOT EXISTS idempotency_cache (
        composite_key TEXT PRIMARY KEY,
        owner_uid TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status INTEGER NOT NULL,
        body_json TEXT NOT NULL
      );
    `);
  }

  public withTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const res = fn();
      this.db.exec('COMMIT;');
      return res;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback errors if transaction wasn't active
      }
      throw err;
    }
  }

  private migrateLegacyJsonIfNeeded(legacyJsonPath: string): boolean {
    const already = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('migrated_legacy_json') as { value: string } | undefined;
    if (already || !fs.existsSync(legacyJsonPath)) {
      return false;
    }

    try {
      const raw = fs.readFileSync(legacyJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as LegacyDiskStoreSchema;
      this.withTransaction(() => {
        for (const [credKey, rec] of Object.entries(parsed.credentials || {})) {
          const [ownerUid = 'local-default', connOrProv = rec.connectionId || rec.provider] =
            credKey.split(':');
          // Skip legacy provider-level duplicate alias if specific connection record exists
          this.upsertCredential(
            credKey,
            ownerUid,
            rec.connectionId || connOrProv,
            rec.provider,
            rec
          );
        }

        for (const [ownerUid, ws] of Object.entries(parsed.workspaces || {})) {
          this.saveWorkspace(ownerUid, ws);
        }

        for (const run of Object.values(parsed.evaluationRuns || {})) {
          this.saveEvaluationRun(run);
        }

        for (const [subKey, sub] of Object.entries(parsed.submissions || {})) {
          this.saveSubmission(subKey, sub);
        }

        for (const [compKey, entry] of Object.entries(parsed.idempotencyRecords || {})) {
          this.saveIdempotentResponse(compKey, entry);
        }

        this.db
          .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
          .run('migrated_legacy_json', new Date().toISOString());
      });

      const backupPath = `${legacyJsonPath}.migrated.bak`;
      if (!fs.existsSync(backupPath)) {
        try {
          fs.renameSync(legacyJsonPath, backupPath);
        } catch {
          // Non-fatal if rename is blocked in sandbox
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public getWorkspace(ownerUid: string): UserAIWorkspaceConfig | null {
    const row = this.db
      .prepare('SELECT config_json FROM workspaces WHERE owner_uid = ?')
      .get(ownerUid) as { config_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.config_json) as UserAIWorkspaceConfig;
  }

  public saveWorkspace(ownerUid: string, config: UserAIWorkspaceConfig): void {
    const now = config.updatedAt || new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO workspaces (owner_uid, config_json, updated_at) VALUES (?, ?, ?)')
      .run(ownerUid, JSON.stringify(config), now);

    // Sync relational index tables for connections & profiles
    this.db.prepare('DELETE FROM provider_connections WHERE owner_uid = ?').run(ownerUid);
    const insConn = this.db.prepare(
      'INSERT OR REPLACE INTO provider_connections (id, owner_uid, provider_type, storage_mode, config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const c of config.connections) {
      insConn.run(c.id, ownerUid, c.providerType, c.storageMode, JSON.stringify(c), c.updatedAt || now);
    }

    this.db.prepare('DELETE FROM model_profiles WHERE owner_uid = ?').run(ownerUid);
    const insProf = this.db.prepare(
      'INSERT OR REPLACE INTO model_profiles (id, connection_id, owner_uid, provider_type, config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const p of config.modelProfiles) {
      insProf.run(p.id, p.connectionId, ownerUid, p.providerType, JSON.stringify(p), p.updatedAt || now);
    }
  }

  public getCredential(credKey: string): EncryptedCredentialRecord | null {
    const row = this.db
      .prepare('SELECT record_json FROM credentials WHERE cred_key = ?')
      .get(credKey) as { record_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.record_json) as EncryptedCredentialRecord;
  }

  public upsertCredential(
    credKey: string,
    ownerUid: string,
    connectionId: string,
    providerType: string,
    record: EncryptedCredentialRecord
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO credentials (cred_key, owner_uid, connection_id, provider_type, record_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        credKey,
        ownerUid,
        connectionId,
        providerType,
        JSON.stringify(record),
        record.updatedAt || new Date().toISOString()
      );
  }

  public deleteCredential(credKey: string): void {
    this.db.prepare('DELETE FROM credentials WHERE cred_key = ?').run(credKey);
  }

  public deleteCredentialsByConnection(ownerUid: string, connectionId: string): void {
    this.db
      .prepare('DELETE FROM credentials WHERE owner_uid = ? AND connection_id = ?')
      .run(ownerUid, connectionId);
    this.deleteCredential(`${ownerUid}:${connectionId}`);
  }

  public saveEvaluationRun(run: EvaluationRun): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO evaluation_runs (run_id, user_id, started_at, run_json) VALUES (?, ?, ?, ?)'
      )
      .run(run.runId, run.userId, run.startedAt, JSON.stringify(run));
  }

  public getEvaluationRun(runId: string): EvaluationRun | null {
    const row = this.db
      .prepare('SELECT run_json FROM evaluation_runs WHERE run_id = ?')
      .get(runId) as { run_json: string } | undefined;
    return row ? (JSON.parse(row.run_json) as EvaluationRun) : null;
  }

  public listEvaluationRuns(ownerUid: string, limit: number = 30): EvaluationRun[] {
    const rows = this.db
      .prepare('SELECT run_json FROM evaluation_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(ownerUid, limit) as Array<{ run_json: string }>;
    return rows.map((r) => JSON.parse(r.run_json) as EvaluationRun);
  }

  public getSubmission(submissionKey: string): AttemptSubmissionRecord | null {
    const row = this.db
      .prepare('SELECT record_json FROM attempt_submissions WHERE submission_key = ?')
      .get(submissionKey) as { record_json: string } | undefined;
    return row ? (JSON.parse(row.record_json) as AttemptSubmissionRecord) : null;
  }

  public listSubmissionsByOwnerAndYear(ownerUid: string, year: number): AttemptSubmissionRecord[] {
    const rows = this.db
      .prepare('SELECT record_json FROM attempt_submissions WHERE owner_uid = ? AND paper_year = ?')
      .all(ownerUid, year) as Array<{ record_json: string }>;
    return rows.map((r) => JSON.parse(r.record_json) as AttemptSubmissionRecord);
  }

  public saveSubmission(submissionKey: string, record: AttemptSubmissionRecord): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO attempt_submissions (submission_key, owner_uid, attempt_id, paper_year, paper_id, record_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        submissionKey,
        record.ownerUid,
        record.attemptId,
        record.year,
        record.paperId || null,
        JSON.stringify(record),
        record.submittedAt
      );
  }

  public getIdempotentResponse(
    ownerUid: string,
    compositeKey: string
  ): StoredIdempotencyEntry | null {
    const row = this.db
      .prepare(
        'SELECT composite_key, owner_uid, created_at, expires_at, status, body_json FROM idempotency_cache WHERE composite_key = ? AND owner_uid = ?'
      )
      .get(compositeKey, ownerUid) as
      | {
          composite_key: string;
          owner_uid: string;
          created_at: number;
          expires_at: number;
          status: number;
          body_json: string;
        }
      | undefined;

    if (!row) return null;
    if (Date.now() > row.expires_at) {
      this.db.prepare('DELETE FROM idempotency_cache WHERE composite_key = ?').run(compositeKey);
      return null;
    }

    return {
      compositeKey: row.composite_key,
      ownerUid: row.owner_uid,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status,
      body: JSON.parse(row.body_json),
    };
  }

  public saveIdempotentResponse(compositeKey: string, entry: StoredIdempotencyEntry): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO idempotency_cache (composite_key, owner_uid, created_at, expires_at, status, body_json) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        compositeKey,
        entry.ownerUid,
        entry.createdAt,
        entry.expiresAt,
        entry.status,
        JSON.stringify(entry.body)
      );
  }

  public listConnectionsByOwner(ownerUid: string): ProviderConnection[] {
    const rows = this.db
      .prepare('SELECT config_json FROM provider_connections WHERE owner_uid = ?')
      .all(ownerUid) as Array<{ config_json: string }>;
    return rows.map((r) => JSON.parse(r.config_json) as ProviderConnection);
  }

  public listProfilesByOwner(ownerUid: string): ModelProfile[] {
    const rows = this.db
      .prepare('SELECT config_json FROM model_profiles WHERE owner_uid = ?')
      .all(ownerUid) as Array<{ config_json: string }>;
    return rows.map((r) => JSON.parse(r.config_json) as ModelProfile);
  }

  public close(): void {
    this.db.close();
  }
}
