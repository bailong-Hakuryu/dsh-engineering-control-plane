import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { posix, resolve, sep } from 'node:path'
import type { EvidenceRecord } from '../kernel/types.js'

export type { EvidenceRecord } from '../kernel/types.js'

/** JSON-only Evidence value accepted by the canonical codec. */
export type EvidenceJson =
  | null
  | boolean
  | number
  | string
  | readonly EvidenceJson[]
  | { readonly [key: string]: EvidenceJson }

/** Input to one publish-before-index Evidence operation. */
export interface PublishEvidenceInput {
  readonly missionId: string
  readonly attempt: number
  readonly kind: string
  readonly schemaVersion: number
  readonly payload: unknown
}

export type EvidenceStoreErrorCode =
  | 'artifact_too_large'
  | 'corrupt_evidence'
  | 'invalid_evidence'
  | 'missing_evidence'
  | 'record_exists'

/** Stable Evidence medium failure. */
export class EvidenceStoreError extends Error {
  constructor(
    readonly code: EvidenceStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'EvidenceStoreError'
  }
}

/** Filesystem Evidence Store options; root is normally `$DSH_HOME/control-plane/missions`. */
export interface FilesystemEvidenceStoreOptions {
  readonly root: string
  readonly maxRecordBytes?: number
  readonly nextRecordId?: () => string
  readonly now?: () => string
}

interface EvidenceEnvelope {
  readonly record: EvidenceRecord
  readonly payload: EvidenceJson
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SENSITIVE_KEY = /^(?:authorization|cookie|password|passwd|secret|token|api_key|api_token|access_token|refresh_token|client_secret)$/u
const DEFAULT_MAX_RECORD_BYTES = 16 * 1024 * 1024
const MAX_JSON_DEPTH = 64
const EVIDENCE_VIEW_NAMES: Readonly<Record<string, string>> = {
  context: 'context.md',
  plan: 'plan.md',
  implementation: 'implementation.diff',
  'test-report': 'test-report.md',
  'review-report': 'review-report.md',
  'final-report': 'final-report.md',
}
const EVIDENCE_VIEW_TITLES: Readonly<Record<string, string>> = {
  context: 'Mission Context',
  plan: 'Plan',
  'test-report': 'Test Report',
  'review-report': 'Review Report',
  'final-report': 'Final Report',
}

function invalid(message: string): EvidenceStoreError {
  return new EvidenceStoreError('invalid_evidence', message)
}

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value)) throw invalid(`${label} is not a safe filesystem identifier`)
}

function isSensitiveKey(key: string): boolean {
  const normalized = key
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replaceAll('-', '_')
    .toLowerCase()
  return SENSITIVE_KEY.test(normalized)
}

function normalizeEvidence(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  mode: 'publish' | 'verify',
  key?: string,
): { readonly value: EvidenceJson; readonly redacted: boolean } {
  if (depth > MAX_JSON_DEPTH) throw invalid(`Evidence JSON exceeds depth ${MAX_JSON_DEPTH}`)
  if (key !== undefined && isSensitiveKey(key)) {
    if (mode === 'verify' && value !== '[REDACTED]') {
      throw invalid(`Sensitive Evidence field '${key}' was not redacted before persistence`)
    }
    return { value: '[REDACTED]', redacted: true }
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return { value, redacted: false }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('Evidence JSON numbers must be finite')
    return { value: Object.is(value, -0) ? 0 : value, redacted: false }
  }
  if (typeof value !== 'object') throw invalid(`Evidence JSON cannot contain ${typeof value}`)
  if (seen.has(value)) throw invalid('Evidence JSON cannot contain cycles')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      let redacted = false
      const normalized = value.map((item) => {
        const result = normalizeEvidence(item, seen, depth + 1, mode)
        redacted ||= result.redacted
        return result.value
      })
      return { value: normalized, redacted }
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalid('Evidence JSON objects must be plain records')
    }
    let redacted = false
    const normalized: Record<string, EvidenceJson> = Object.create(null) as Record<string, EvidenceJson>
    for (const property of Object.keys(value).sort()) {
      const result = normalizeEvidence(Reflect.get(value, property), seen, depth + 1, mode, property)
      normalized[property] = result.value
      redacted ||= result.redacted
    }
    return { value: normalized, redacted }
  } finally {
    seen.delete(value)
  }
}

/** Deterministically encode JSON after validation, key ordering and secret-key redaction. */
export function canonicalizeEvidence(value: unknown): { readonly json: string; readonly value: EvidenceJson; readonly redacted: boolean } {
  const normalized = normalizeEvidence(value, new WeakSet(), 0, 'publish')
  return {
    json: JSON.stringify(normalized.value),
    value: normalized.value,
    redacted: normalized.redacted,
  }
}

function canonicalizeStoredEvidence(value: unknown): ReturnType<typeof canonicalizeEvidence> {
  const normalized = normalizeEvidence(value, new WeakSet(), 0, 'verify')
  return {
    json: JSON.stringify(normalized.value),
    value: normalized.value,
    redacted: normalized.redacted,
  }
}

function digest(json: string): string {
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`
}

function sameRecord(left: EvidenceRecord, right: EvidenceRecord): boolean {
  return left.recordId === right.recordId
    && left.missionId === right.missionId
    && left.attempt === right.attempt
    && left.kind === right.kind
    && left.schemaVersion === right.schemaVersion
    && left.digest === right.digest
    && left.byteLength === right.byteLength
    && left.relativePath === right.relativePath
    && left.redacted === right.redacted
    && left.createdAt === right.createdAt
}

function objectValue(value: EvidenceJson): Readonly<Record<string, EvidenceJson>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, EvidenceJson>>
}

function evidenceView(record: EvidenceRecord, payload: EvidenceJson): string | undefined {
  const viewName = EVIDENCE_VIEW_NAMES[record.kind]
  if (viewName === undefined) return undefined
  const notice = [
    'Non-authoritative Evidence View',
    `Evidence Record: ${record.recordId}`,
    `Digest: ${record.digest}`,
  ]
  if (viewName === 'implementation.diff') {
    const capture = objectValue(objectValue(payload)?.capture ?? null)
    const trackedDiff = capture?.trackedDiff
    const untracked = capture?.untracked
    return [
      ...notice.map(line => `# ${line}`),
      '',
      typeof trackedDiff === 'string' && trackedDiff.length > 0
        ? trackedDiff.trimEnd()
        : '# No tracked diff was captured.',
      '',
      '# Untracked Evidence',
      ...JSON.stringify(untracked ?? [], null, 2).split('\n').map(line => `# ${line}`),
      '',
    ].join('\n')
  }
  return [
    `# ${EVIDENCE_VIEW_TITLES[record.kind] ?? record.kind}`,
    '',
    `> ${notice.join(' · ')}`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n')
}

async function publishImmutableFile(
  finalPath: string,
  bytes: Uint8Array,
  identifier: string,
  collisionMessage: string,
): Promise<void> {
  const directory = resolve(finalPath, '..')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = resolve(directory, `.${identifier}.${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(temporaryPath, finalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EvidenceStoreError('record_exists', collisionMessage, { cause: error })
    }
    throw error
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

/** Canonical filesystem Evidence implementation with publish-before-index semantics. */
export class FilesystemEvidenceStore {
  private readonly root: string
  private readonly maxRecordBytes: number
  private readonly nextRecordId: () => string
  private readonly now: () => string

  constructor(options: FilesystemEvidenceStoreOptions) {
    this.root = resolve(options.root)
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES
    this.nextRecordId = options.nextRecordId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
    if (!Number.isSafeInteger(this.maxRecordBytes) || this.maxRecordBytes <= 0) {
      throw new RangeError('maxRecordBytes must be a positive safe integer')
    }
  }

  /** Publish a complete immutable envelope before a Mission may index it. */
  async publish(input: PublishEvidenceInput): Promise<EvidenceRecord> {
    assertSafeSegment(input.missionId, 'missionId')
    assertSafeSegment(input.kind, 'kind')
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) throw invalid('attempt must be a positive integer')
    if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw invalid('schemaVersion must be a positive integer')
    }

    const recordId = this.nextRecordId()
    assertSafeSegment(recordId, 'recordId')
    const canonical = canonicalizeEvidence(input.payload)
    const relativePath = posix.join(
      input.missionId,
      `attempt-${String(input.attempt).padStart(4, '0')}`,
      'records',
      `${recordId}.json`,
    )
    const record: EvidenceRecord = {
      recordId,
      missionId: input.missionId,
      attempt: input.attempt,
      kind: input.kind,
      schemaVersion: input.schemaVersion,
      digest: digest(canonical.json),
      byteLength: Buffer.byteLength(canonical.json, 'utf8'),
      relativePath,
      redacted: canonical.redacted,
      createdAt: this.now(),
    }
    const envelopeJson = JSON.stringify({ record, payload: canonical.value } satisfies EvidenceEnvelope)
    const envelopeBytes = Buffer.from(envelopeJson, 'utf8')
    if (envelopeBytes.byteLength > this.maxRecordBytes) {
      throw new EvidenceStoreError(
        'artifact_too_large',
        `Evidence envelope is ${envelopeBytes.byteLength} bytes; limit is ${this.maxRecordBytes}`,
      )
    }

    const view = evidenceView(record, canonical.value)
    const viewBytes = view === undefined ? undefined : Buffer.from(view, 'utf8')
    if (viewBytes !== undefined && viewBytes.byteLength > this.maxRecordBytes) {
      throw new EvidenceStoreError(
        'artifact_too_large',
        `Evidence View is ${viewBytes.byteLength} bytes; limit is ${this.maxRecordBytes}`,
      )
    }

    const finalPath = this.resolveRecordPath(relativePath)
    await publishImmutableFile(
      finalPath,
      envelopeBytes,
      recordId,
      `Evidence Record '${recordId}' already exists`,
    )
    const viewName = EVIDENCE_VIEW_NAMES[input.kind]
    if (viewBytes !== undefined && viewName !== undefined) {
      const viewRelativePath = posix.join(
        input.missionId,
        `attempt-${String(input.attempt).padStart(4, '0')}`,
        viewName,
      )
      await publishImmutableFile(
        this.resolveRecordPath(viewRelativePath),
        viewBytes,
        `${recordId}-view`,
        `Evidence View '${viewRelativePath}' already exists`,
      )
    }
    return record
  }

  /** Read payload only after envelope identity and digest validation. */
  async read(record: EvidenceRecord): Promise<EvidenceJson> {
    return (await this.loadEnvelope(record)).payload
  }

  /** Inspect a manifest reference without throwing for expected absence or corruption. */
  async inspect(record: EvidenceRecord): Promise<{ readonly state: 'valid' | 'missing' | 'corrupt' }> {
    try {
      await this.loadEnvelope(record)
      return { state: 'valid' }
    } catch (error) {
      if (error instanceof EvidenceStoreError && error.code === 'missing_evidence') return { state: 'missing' }
      return { state: 'corrupt' }
    }
  }

  private async loadEnvelope(record: EvidenceRecord): Promise<EvidenceEnvelope> {
    let text: string
    try {
      text = await readFile(this.resolveRecordPath(record.relativePath), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new EvidenceStoreError('missing_evidence', `Evidence Record '${record.recordId}' is missing`, { cause: error })
      }
      throw new EvidenceStoreError('corrupt_evidence', `Evidence Record '${record.recordId}' cannot be read`, { cause: error })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new EvidenceStoreError('corrupt_evidence', `Evidence Record '${record.recordId}' is not JSON`, { cause: error })
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new EvidenceStoreError('corrupt_evidence', `Evidence Record '${record.recordId}' has no envelope`)
    }
    const storedRecord = Reflect.get(parsed, 'record') as EvidenceRecord | undefined
    const payload = Reflect.get(parsed, 'payload')
    if (typeof storedRecord !== 'object' || storedRecord === null || !sameRecord(storedRecord, record)) {
      throw new EvidenceStoreError('corrupt_evidence', `Evidence Record '${record.recordId}' metadata changed`)
    }
    let canonical: ReturnType<typeof canonicalizeEvidence>
    try {
      canonical = canonicalizeStoredEvidence(payload)
    } catch (error) {
      throw new EvidenceStoreError('corrupt_evidence', `Evidence Record '${record.recordId}' payload is invalid`, { cause: error })
    }
    if (
      canonical.redacted !== record.redacted
      || digest(canonical.json) !== record.digest
      || Buffer.byteLength(canonical.json) !== record.byteLength
    ) {
      throw new EvidenceStoreError('corrupt_evidence', `Evidence Record '${record.recordId}' digest changed`)
    }
    return { record, payload: canonical.value }
  }

  private resolveRecordPath(relativePath: string): string {
    if (relativePath.includes('\\')) throw new EvidenceStoreError('corrupt_evidence', 'Evidence path uses a foreign separator')
    const absolute = resolve(this.root, ...relativePath.split('/'))
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${sep}`)) {
      throw new EvidenceStoreError('corrupt_evidence', 'Evidence path escapes the configured root')
    }
    return absolute
  }
}

/** Create a filesystem Evidence Store over one plugin-owned root. */
export function createFilesystemEvidenceStore(options: FilesystemEvidenceStoreOptions): FilesystemEvidenceStore {
  return new FilesystemEvidenceStore(options)
}
