import { createHash } from 'node:crypto'

export interface AssuranceWorkspaceFingerprintInputV1 {
  readonly branch: string
  readonly head: string
  /** Exact UTF-8 output of `git status --porcelain=v2 -z --untracked-files=all`. */
  readonly status: string
}

export interface AssuranceProducedChangeFingerprintInputV1 {
  readonly baseCommit: string
  /** Exact UTF-8 output of `git diff --binary --no-ext-diff HEAD --`. */
  readonly trackedDiff: string
  /** Exact Git enumeration order from `git ls-files --others --exclude-standard -z`. */
  readonly untrackedFiles: readonly {
    readonly path: string
    readonly digest: string
  }[]
}

/** Stable protocol identifier for the workspace identity supplied to Assurance Providers. */
export const ASSURANCE_WORKSPACE_FINGERPRINT_ALGORITHM_V1 =
  'sha256-git-branch-nul-head-nul-porcelain-v2-z-v1' as const

/** Stable protocol identifier for the byte-exact produced change supplied to Providers. */
export const ASSURANCE_PRODUCED_CHANGE_FINGERPRINT_ALGORITHM_V1 =
  'sha256-git-base-diff-untracked-v1' as const

/** Compute the V1 path-free identity of one exact Git branch, HEAD, index, and worktree state. */
export function computeAssuranceWorkspaceFingerprintV1(
  input: AssuranceWorkspaceFingerprintInputV1,
): string {
  if (input.branch.length === 0 || input.branch !== input.branch.trim() || input.branch.includes('\0')) {
    throw new TypeError('Assurance workspace branch must be one canonical non-empty name')
  }
  if (!/^[0-9a-f]{40,64}$/u.test(input.head)) {
    throw new TypeError('Assurance workspace HEAD must be one exact Git object id')
  }
  return `sha256:${createHash('sha256')
    .update(`${input.branch}\0${input.head}\0${input.status}`)
    .digest('hex')}`
}

/** Bind the baseline-relative tracked patch and every admitted untracked file byte-for-byte. */
export function computeAssuranceProducedChangeFingerprintV1(
  input: AssuranceProducedChangeFingerprintInputV1,
): string {
  if (!/^[0-9a-f]{40,64}$/u.test(input.baseCommit)) {
    throw new TypeError('Assurance produced change base must be one exact Git object id')
  }
  const seen = new Set<string>()
  const untrackedFiles = input.untrackedFiles.map(file => {
    if (file.path.length === 0 || file.path.includes('\0') || seen.has(file.path)) {
      throw new TypeError('Assurance produced change paths must be unique non-empty Git paths')
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(file.digest)) {
      throw new TypeError('Assurance produced change file digest must be a SHA-256 envelope')
    }
    seen.add(file.path)
    return { path: file.path, digest: file.digest }
  })
  const trackedDiffDigest = `sha256:${createHash('sha256')
    .update(input.trackedDiff)
    .digest('hex')}`
  const canonical = JSON.stringify({
    schemaVersion: 1,
    baseCommit: input.baseCommit,
    trackedDiffDigest,
    untrackedFiles,
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}
