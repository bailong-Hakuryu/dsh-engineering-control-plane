---
status: accepted
---

# Harness RC compatibility is exact and probed

The first v0.2 release supports the tested DeepSeek Harness `0.1.1-rc.2` package family and Node `^22.19.0 || >=24.0.0` rather than assuming future release candidates are compatible. Harness RC peer dependencies are exact, while stable vendor dependencies may retain reviewed ranges. Startup also performs read-only public Capability Probes; an unverified version or missing semantic capability enters Safe Mode. Adding a Harness version requires the compatibility suite and matrix update, never copied Core code or private `src/*` coupling.
