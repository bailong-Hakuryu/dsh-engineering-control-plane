---
status: accepted
---

# Filesystem Actions bind stable file identities

Repository-relative path normalization is necessary but not sufficient for Action authorization. Filesystem adapters open through safe host primitives and validate handle-derived target and parent identities, file type, Repository Identity, and containment at decision, dispatch, and Outcome boundaries. Symlink, junction, hard-link, reparse-point, or other alias escape is denied, and an identity change during the operation produces `FILESYSTEM_IDENTITY_INDETERMINATE` rather than a fabricated success. This closes time-of-check/time-of-use gaps across supported platforms without delegating containment to model prose or one preflight string check.
