---
status: accepted
---

# Direct-use verification runs package scripts without installing

The direct-use bundle verified every repository with fixed pnpm commands: `pnpm test`, `pnpm run typecheck`, and `pnpm run build`. A real Mission on a small npm repository showed two defects. pnpm verifies dependencies before `run` and installs when they look stale, and that install ran the repository's root `postinstall`, which the operator had not sanctioned; it also wrote `node_modules/` and `pnpm-lock.yaml` into the worktree. And a repository without `typecheck` or `build` scripts failed those categories on every attempt, so the Mission could only ever be sent back for rework.

A verification category may now be a `package_script`: one script name, a timeout, and whether a repository that does not define it fails the category or makes it not applicable. At verification time the adapter reads the repository's `package.json` and chooses the package manager the repository declares — its `packageManager` field, then its lockfile, else npm — and runs the script through that manager's `run` without installing: pnpm receives `--config.verify-deps-before-run=false`, and npm, Yarn, and Bun never install on `run`. The resolved manager and argv are recorded in verification evidence. The direct-use bundle requires `test` and treats `typecheck` and `build` as not applicable where they are absent, so a Mission can never pass without a test script yet is not failed for steps the project does not have.

Verification therefore never installs dependencies: a repository whose dependencies are not installed fails its checks instead of being installed silently. Script bodies still run, as tests always do; only install lifecycle scripts no longer run. Explicit `commands` categories are unchanged, so a Host profile that needs other tools keeps full control of its argv.
