---
status: accepted
---

# Workspace identity is a versioned Provider protocol

The Control Plane publishes two V1 workspace identity algorithms from its
`assurance-provider` entrypoint. V1 hashes the exact UTF-8 sequence
`branch NUL head NUL status`, where `status` is the complete output of
`git status --porcelain=v2 -z --untracked-files=all`, and emits a lowercase
`sha256:` Workspace Fingerprint envelope. This detects the Git state used by
recovery boundaries, but the status record alone is not a byte-exact content
seal.

The separate Produced Change Fingerprint binds the baseline commit, a digest
of the complete `git diff --binary --no-ext-diff HEAD --` output, and the path
plus raw byte digest of every non-ignored untracked regular file. The baseline
therefore supplies unchanged tracked content while the fingerprint binds every
resulting tracked and untracked change admitted to the Mission.

The Kernel still owns observation and freezes the resulting value into the
Attempt Assurance Subject. Publishing the pure algorithm does not grant a
Provider filesystem authority or disclose a Repository path; it lets a
Provider with its own independently bound Repository prove both that the Git
state matches and that the bytes it freezes are the same produced change the
Kernel named.

Changing Git arguments, field order, separators, canonical JSON construction,
text decoding, or digest encoding requires a new algorithm version. Providers
must fail closed when either observed value does not equal the Kernel-issued
fingerprint.
