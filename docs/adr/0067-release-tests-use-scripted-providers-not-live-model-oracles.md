---
status: accepted
---

# Release tests use Scripted Providers, not live-model oracles

Blocking automated tests use deterministic Scripted Providers capable of emitting valid, malformed, adversarial, timed-out, cancelled, and usage-bounded Role results. CI therefore does not depend on model network availability, quota, or sampling variance while still exercising the real Governed Provider and RoleRun contracts. Opt-in live-model canaries verify practical compatibility and produce explicitly nondeterministic observations, but they never replace deterministic Kernel evidence or become the sole release oracle.
