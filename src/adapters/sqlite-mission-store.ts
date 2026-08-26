import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import type {
  MissionStore,
  MissionUpdate,
  StartAcceptance,
} from '../kernel/memory-store.js'
import type { MissionId, MissionSnapshot } from '../kernel/types.js'

/** Current on-disk Mission Store schema version. */
export const MISSION_STORE_SCHEMA_VERSION = 2
/** `DSHC` encoded as a positive SQLite application id. */
export const MISSION_STORE_APPLICATION_ID = 0x4453_4843

export type SqliteJournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** Production Mission Store construction options. */
export interface SqliteMissionStoreOptions {
  readonly path: string
  readonly journalMode?: SqliteJournalMode
  readonly busyTimeoutMs?: number
}

/** Read-only facts returned to the package doctor without opening mutation paths. */
export interface SqliteMissionStoreInspection {
  readonly path: string
  readonly schemaVersion: number
  readonly applicationId: number
  readonly quickCheck: string
  readonly snapshots: readonly MissionSnapshot[]
}

/** Stable fail-closed persistence diagnostics. */
export type MissionStoreFormatErrorCode =
  | 'closed'
  | 'corrupt_store'
  | 'unsupported_format'

/** Persistence failure whose code is safe for doctor/startup reporting. */
export class MissionStoreFormatError extends Error {
  constructor(
    readonly code: MissionStoreFormatErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MissionStoreFormatError'
  }
}

interface MissionRow {
  readonly mission_id: string
  readonly revision: number
  readonly snapshot_json: string
}

const SCHEMA_SQL = `
  CREATE TABLE missions (
    mission_id      TEXT PRIMARY KEY,
    canonical_root  TEXT NOT NULL,
    revision        INTEGER NOT NULL CHECK (revision >= 1),
    status          TEXT NOT NULL,
    snapshot_json   TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX missions_one_active_per_repository
    ON missions (canonical_root)
    WHERE status NOT IN ('APPROVED', 'CANCELLED');

  CREATE TABLE starts (
    idempotency_key TEXT PRIMARY KEY,
    mission_id      TEXT NOT NULL REFERENCES missions(mission_id)
  ) STRICT;
`

function integerField(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null) {
    throw new MissionStoreFormatError('corrupt_store', `SQLite ${key} result is not an object`)
  }
  const field = Reflect.get(value, key)
  if (!Number.isSafeInteger(field)) {
    throw new MissionStoreFormatError('corrupt_store', `SQLite ${key} is not a safe integer`)
  }
  return field as number
}

function normalizedSchema(db: DatabaseSync): readonly unknown[] {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all().map((row) => {
    if (typeof row !== 'object' || row === null) {
      throw new MissionStoreFormatError('corrupt_store', 'SQLite schema row is malformed')
    }
    const sql = Reflect.get(row, 'sql')
    return {
      type: Reflect.get(row, 'type'),
      name: Reflect.get(row, 'name'),
      tbl_name: Reflect.get(row, 'tbl_name'),
      sql: typeof sql === 'string' ? sql.replaceAll(/\s+/gu, ' ').trim() : sql,
    }
  })
}

let canonicalSchema: readonly unknown[] | undefined

function expectedSchema(): readonly unknown[] {
  canonicalSchema ??= (() => {
    const reference = new DatabaseSync(':memory:')
    try {
      reference.exec(SCHEMA_SQL)
      return normalizedSchema(reference)
    } finally {
      reference.close()
    }
  })()
  return canonicalSchema
}

function validateSchema(db: DatabaseSync, path: string): void {
  const actual = JSON.stringify(normalizedSchema(db))
  const expected = JSON.stringify(expectedSchema())
  if (actual !== expected) {
    throw new MissionStoreFormatError(
      'corrupt_store',
      `Mission database at "${path}" does not contain the required schema`,
    )
  }
}

function validateIdentity(db: DatabaseSync, path: string): void {
  const version = integerField(db.prepare('PRAGMA user_version').get(), 'user_version')
  const applicationId = integerField(db.prepare('PRAGMA application_id').get(), 'application_id')
  if (version > MISSION_STORE_SCHEMA_VERSION) {
    throw new MissionStoreFormatError(
      'unsupported_format',
      `Mission database at "${path}" has schema ${version}; this build supports ${MISSION_STORE_SCHEMA_VERSION}`,
    )
  }
  if (version !== MISSION_STORE_SCHEMA_VERSION || applicationId !== MISSION_STORE_APPLICATION_ID) {
    throw new MissionStoreFormatError(
      'corrupt_store',
      `Mission database at "${path}" has an invalid application identity or schema version`,
    )
  }
}

function userObjectCount(db: DatabaseSync): number {
  return integerField(db.prepare(`
    SELECT count(*) AS count
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
  `).get(), 'count')
}

function initializeFreshDatabase(db: DatabaseSync, path: string): void {
  const version = integerField(db.prepare('PRAGMA user_version').get(), 'user_version')
  const applicationId = integerField(db.prepare('PRAGMA application_id').get(), 'application_id')
  if (version !== 0 || applicationId !== 0 || userObjectCount(db) !== 0) {
    throw new MissionStoreFormatError(
      'corrupt_store',
      `Mission database at "${path}" contains an unversioned or foreign schema`,
    )
  }
  db.exec(SCHEMA_SQL)
  db.exec(`PRAGMA application_id = ${MISSION_STORE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${MISSION_STORE_SCHEMA_VERSION}`)
}

function beginImmediate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
}

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    // Preserve the original transaction failure.
  }
}

async function createDatabaseFile(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return false
  }
}

/** Prove an existing Store is safe to open for mutation without changing any source byte. */
function preflightExistingDatabase(path: string): void {
  const immutableUrl = pathToFileURL(path)
  immutableUrl.searchParams.set('immutable', '1')
  const db = new DatabaseSync(immutableUrl.href, { readOnly: true })
  try {
    const integrity = db.prepare('PRAGMA quick_check').get() as { quick_check?: unknown } | undefined
    if (integrity?.quick_check !== 'ok') {
      throw new MissionStoreFormatError('corrupt_store', `Mission database at "${path}" failed quick_check`)
    }
    const version = integerField(db.prepare('PRAGMA user_version').get(), 'user_version')
    const applicationId = integerField(db.prepare('PRAGMA application_id').get(), 'application_id')
    if (version > MISSION_STORE_SCHEMA_VERSION) {
      throw new MissionStoreFormatError(
        'unsupported_format',
        `Mission database at "${path}" has schema ${version}; this build supports ${MISSION_STORE_SCHEMA_VERSION}`,
      )
    }
    if (version === 0) {
      if (applicationId !== 0 || userObjectCount(db) !== 0) {
        throw new MissionStoreFormatError(
          'corrupt_store',
          `Mission database at "${path}" contains an unversioned or foreign schema`,
        )
      }
      return
    }
    if (applicationId !== MISSION_STORE_APPLICATION_ID) {
      throw new MissionStoreFormatError('corrupt_store', `Mission database at "${path}" has a foreign application id`)
    }
    validateSchema(db, path)
    const rows = db.prepare(`
      SELECT mission_id, revision, snapshot_json
      FROM missions
      ORDER BY mission_id
    `).all() as unknown as MissionRow[]
    for (const row of rows) {
      const snapshot = decodeSnapshot(row, path) as MissionSnapshot & { readonly writeLease?: unknown }
      if (version === 1 && (snapshot.writeLease !== undefined || typeof snapshot.updatedAt !== 'string')) {
        throw new MissionStoreFormatError(
          'corrupt_store',
          `Mission '${snapshot.missionId}' cannot be migrated from schema 1`,
        )
      }
    }
  } finally {
    db.close()
  }
}

function backupPath(path: string, version: number): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')
  return `${path}.v${version}.backup-${timestamp}`
}

async function migrateIfRequired(db: DatabaseSync, path: string, onDisk: number): Promise<void> {
  if (onDisk === MISSION_STORE_SCHEMA_VERSION) return
  if (onDisk === 0) {
    beginImmediate(db)
    try {
      initializeFreshDatabase(db, path)
      db.exec('COMMIT')
      return
    } catch (error) {
      rollbackQuietly(db)
      throw error
    }
  }
  if (onDisk > MISSION_STORE_SCHEMA_VERSION) {
    throw new MissionStoreFormatError(
      'unsupported_format',
      `Mission database at "${path}" has schema ${onDisk}; this build supports ${MISSION_STORE_SCHEMA_VERSION}`,
    )
  }

  await backup(db, backupPath(path, onDisk))
  if (onDisk !== 1) {
    throw new MissionStoreFormatError(
      'unsupported_format',
      `Mission database migration from schema ${onDisk} is not available in this build`,
    )
  }
  const applicationId = integerField(db.prepare('PRAGMA application_id').get(), 'application_id')
  if (applicationId !== MISSION_STORE_APPLICATION_ID) {
    throw new MissionStoreFormatError('corrupt_store', `Mission database at "${path}" has a foreign application id`)
  }
  validateSchema(db, path)
  beginImmediate(db)
  try {
    const rows = db.prepare(`
      SELECT mission_id, revision, snapshot_json
      FROM missions
      ORDER BY mission_id
    `).all() as unknown as MissionRow[]
    const update = db.prepare('UPDATE missions SET snapshot_json = ? WHERE mission_id = ?')
    for (const row of rows) {
      const legacy = decodeSnapshot(row, path) as MissionSnapshot & { readonly writeLease?: unknown }
      if (legacy.writeLease !== undefined || typeof legacy.updatedAt !== 'string') {
        throw new MissionStoreFormatError(
          'corrupt_store',
          `Mission '${legacy.missionId}' cannot be migrated from schema 1`,
        )
      }
      update.run(JSON.stringify({
        ...legacy,
        writeLease: {
          fencingToken: 0,
          releasedAt: legacy.updatedAt,
        },
      } satisfies MissionSnapshot), legacy.missionId)
    }
    db.exec(`PRAGMA user_version = ${MISSION_STORE_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    rollbackQuietly(db)
    throw error
  }
}

async function openDatabase(options: SqliteMissionStoreOptions): Promise<{ db: DatabaseSync; path: string }> {
  const actual = options.path === ':memory:' ? options.path : resolve(options.path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    const created = await createDatabaseFile(actual)
    if (!created) preflightExistingDatabase(actual)
  }

  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 2_147_483_647) {
    throw new RangeError('busyTimeoutMs must be an integer between 0 and 2147483647')
  }
  const journalMode = options.journalMode ?? 'wal'
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA trusted_schema = OFF')
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`)
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    db.exec('PRAGMA synchronous = FULL')
    const integrity = db.prepare('PRAGMA quick_check').get() as { quick_check?: unknown } | undefined
    if (integrity?.quick_check !== 'ok') {
      throw new MissionStoreFormatError('corrupt_store', `Mission database at "${actual}" failed quick_check`)
    }
    const onDisk = integerField(db.prepare('PRAGMA user_version').get(), 'user_version')
    await migrateIfRequired(db, actual, onDisk)
    validateIdentity(db, actual)
    validateSchema(db, actual)
    return { db, path: actual }
  } catch (error) {
    db.close()
    throw error
  }
}

function decodeSnapshot(row: MissionRow, path: string): MissionSnapshot {
  let value: unknown
  try {
    value = JSON.parse(row.snapshot_json)
  } catch (error) {
    throw new MissionStoreFormatError(
      'corrupt_store',
      `Mission '${row.mission_id}' in "${path}" contains malformed JSON`,
      { cause: error },
    )
  }
  if (typeof value !== 'object' || value === null) {
    throw new MissionStoreFormatError('corrupt_store', `Mission '${row.mission_id}' is not an object`)
  }
  if (Reflect.get(value, 'missionId') !== row.mission_id || Reflect.get(value, 'revision') !== row.revision) {
    throw new MissionStoreFormatError(
      'corrupt_store',
      `Mission '${row.mission_id}' indexed fields disagree with its snapshot`,
    )
  }
  return value as MissionSnapshot
}

/** SQLite-backed authoritative Mission persistence Adapter. */
export class SqliteMissionStore implements MissionStore {
  private closed = false

  constructor(
    private readonly db: DatabaseSync,
    private readonly path: string,
  ) {}

  async acceptStart(
    idempotencyKey: string,
    canonicalRoot: string,
    createSnapshot: () => MissionSnapshot,
  ): Promise<StartAcceptance> {
    this.ensureOpen()
    beginImmediate(this.db)
    try {
      this.validateForMutation()
      const replay = this.db.prepare(`
        SELECT m.mission_id, m.revision, m.snapshot_json
        FROM starts AS s
        JOIN missions AS m ON m.mission_id = s.mission_id
        WHERE s.idempotency_key = ?
      `).get(idempotencyKey) as MissionRow | undefined
      if (replay !== undefined) {
        this.db.exec('COMMIT')
        return { kind: 'replayed', snapshot: decodeSnapshot(replay, this.path) }
      }

      const active = this.db.prepare(`
        SELECT mission_id, revision, snapshot_json
        FROM missions
        WHERE canonical_root = ? AND status NOT IN ('APPROVED', 'CANCELLED')
      `).get(canonicalRoot) as MissionRow | undefined
      if (active !== undefined) {
        this.db.exec('COMMIT')
        return { kind: 'repository_busy', snapshot: decodeSnapshot(active, this.path) }
      }

      const snapshot = createSnapshot()
      this.db.prepare(`
        INSERT INTO missions (
          mission_id, canonical_root, revision, status, snapshot_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.missionId,
        snapshot.repository.canonicalRoot,
        snapshot.revision,
        snapshot.status,
        JSON.stringify(snapshot),
        snapshot.updatedAt,
      )
      this.db.prepare('INSERT INTO starts (idempotency_key, mission_id) VALUES (?, ?)')
        .run(idempotencyKey, snapshot.missionId)
      this.db.exec('COMMIT')
      return { kind: 'accepted', snapshot }
    } catch (error) {
      rollbackQuietly(this.db)
      throw error
    }
  }

  async get(missionId: MissionId | string): Promise<MissionSnapshot | undefined> {
    this.ensureOpen()
    validateIdentity(this.db, this.path)
    const row = this.db.prepare(`
      SELECT mission_id, revision, snapshot_json
      FROM missions
      WHERE mission_id = ?
    `).get(missionId) as MissionRow | undefined
    return row === undefined ? undefined : decodeSnapshot(row, this.path)
  }

  async update(
    missionId: MissionId,
    expectedRevision: number,
    update: (current: MissionSnapshot) => MissionSnapshot,
  ): Promise<MissionUpdate> {
    this.ensureOpen()
    beginImmediate(this.db)
    try {
      this.validateForMutation()
      const row = this.db.prepare(`
        SELECT mission_id, revision, snapshot_json
        FROM missions
        WHERE mission_id = ?
      `).get(missionId) as MissionRow | undefined
      if (row === undefined) {
        this.db.exec('COMMIT')
        return { kind: 'not_found' }
      }
      const current = decodeSnapshot(row, this.path)
      if (current.revision !== expectedRevision) {
        this.db.exec('COMMIT')
        return { kind: 'revision_conflict', snapshot: current }
      }

      const next = update(current)
      if (next.missionId !== current.missionId || next.revision !== current.revision + 1) {
        throw new Error('Mission update must preserve identity and increment revision exactly once')
      }
      const result = this.db.prepare(`
        UPDATE missions
        SET canonical_root = ?, revision = ?, status = ?, snapshot_json = ?, updated_at = ?
        WHERE mission_id = ? AND revision = ?
      `).run(
        next.repository.canonicalRoot,
        next.revision,
        next.status,
        JSON.stringify(next),
        next.updatedAt,
        missionId,
        expectedRevision,
      )
      if (result.changes !== 1) throw new Error('Mission compare-and-swap lost its write reservation')
      this.db.exec('COMMIT')
      return { kind: 'updated', snapshot: next }
    } catch (error) {
      rollbackQuietly(this.db)
      throw error
    }
  }

  /** Enumerate durable non-terminal Missions for explicit startup recovery. */
  async listNonTerminal(): Promise<readonly MissionSnapshot[]> {
    this.ensureOpen()
    validateIdentity(this.db, this.path)
    const rows = this.db.prepare(`
      SELECT mission_id, revision, snapshot_json
      FROM missions
      WHERE status NOT IN ('APPROVED', 'CANCELLED')
      ORDER BY updated_at, mission_id
    `).all() as unknown as MissionRow[]
    return rows.map(row => decodeSnapshot(row, this.path))
  }

  /** Close the owned SQLite connection. Idempotent. */
  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
    return Promise.resolve()
  }

  private validateForMutation(): void {
    validateIdentity(this.db, this.path)
    validateSchema(this.db, this.path)
  }

  private ensureOpen(): void {
    if (this.closed) throw new MissionStoreFormatError('closed', 'Mission Store is closed')
  }
}

/** Open and validate the plugin-owned SQLite Mission Store. */
export async function openSqliteMissionStore(options: SqliteMissionStoreOptions): Promise<SqliteMissionStore> {
  const opened = await openDatabase(options)
  return new SqliteMissionStore(opened.db, opened.path)
}

/** Open an existing database read-only and validate its complete current format. */
export function inspectSqliteMissionStore(path: string): SqliteMissionStoreInspection {
  const actual = resolve(path)
  const immutableUrl = pathToFileURL(actual)
  immutableUrl.searchParams.set('immutable', '1')
  const db = new DatabaseSync(immutableUrl.href, { readOnly: true })
  try {
    const integrity = db.prepare('PRAGMA quick_check').get() as { quick_check?: unknown } | undefined
    const quickCheck = typeof integrity?.quick_check === 'string' ? integrity.quick_check : 'invalid-result'
    if (quickCheck !== 'ok') {
      throw new MissionStoreFormatError('corrupt_store', `Mission database at "${actual}" failed quick_check`)
    }
    const schemaVersion = integerField(db.prepare('PRAGMA user_version').get(), 'user_version')
    const applicationId = integerField(db.prepare('PRAGMA application_id').get(), 'application_id')
    if (schemaVersion < MISSION_STORE_SCHEMA_VERSION) {
      throw new MissionStoreFormatError(
        'unsupported_format',
        `Mission database at "${actual}" requires migration from schema ${schemaVersion}`,
      )
    }
    validateIdentity(db, actual)
    validateSchema(db, actual)
    const rows = db.prepare(`
      SELECT mission_id, revision, snapshot_json
      FROM missions
      ORDER BY updated_at, mission_id
    `).all() as unknown as MissionRow[]
    return {
      path: actual,
      schemaVersion,
      applicationId,
      quickCheck,
      snapshots: rows.map(row => decodeSnapshot(row, actual)),
    }
  } finally {
    db.close()
  }
}
