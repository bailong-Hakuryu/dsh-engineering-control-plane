# v0.1 Acceptance Checklist

## Package

- Package: `dsh-engineering-control-plane`
- Version: `0.1.8`
- Node.js: `^22.19.0 || >=24.0.0`
- License: MIT

The package is prepared for local acceptance. Tagging, GitHub upload, and npm
publication remain deferred until the delivery owner verifies the exact
artifact and source revision.

## Automated gates

Run:

```sh
pnpm release:check
```

This covers lint, type checking, the complete deterministic test suite, a clean
build, and npm pack inspection. The dual-plugin packed installation and real
browser integration are additionally exercised by the Security Assurance
candidate's `pnpm release:check`.

## Acceptance gates

- Verify the delivered tarball digest and install it without workspace links.
- Exercise Mission start, decision, execution, assurance, recovery,
  cancellation, and final Gate behavior under deployment-owned policy.
- Confirm the GitHub destination, package ownership, npm authentication/2FA,
  final release notes, and release tag.
- Treat any post-acceptance behavior or configuration change as a new candidate
  requiring the applicable release gates again.
