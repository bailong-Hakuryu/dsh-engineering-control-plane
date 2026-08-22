---
status: accepted
---

# Packed Installation is the plugin boundary proof

Release qualification runs `npm pack`, installs the tarball into a clean standalone project, and loads the root Service, `./tools`, `./client`, and bundle patch using only declared peer dependencies and public package exports. Static and packed checks reject local absolute paths, workspace links, relative imports into `deepseek-harness-master`, private Harness source imports, and undeclared runtime dependencies. The Harness checkout is a read-only compatibility fixture and is never modified by plugin build, tests, installation, or operation.
