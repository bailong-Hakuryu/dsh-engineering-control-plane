---
status: accepted
---

# Role Agents use a pre-publication Governed Provider

The plugin supplies a `governed-spawn` Subagent Provider that continues to expose Role Runs through `ctx.subagents.start()` while constructing each in-process child through the public `AgentRegistry.create({ setup })` transaction. Role Binding, static tool restrictions, Action Gate mediation, structured-result capture, and role instructions must all be installed before Agent publication and the first prompt; attaching policy after `SubagentRuntime.start()` would leave a first-action race. Effective Policy may select only Providers registered as Gate-Compatible, and an unsupported Provider blocks or rejects the Mission instead of silently degrading. This is implemented entirely in the plugin and requires no change to DeepSeek Harness Core.

Effective Policy freezes the Governed Provider Identity as provider name, Protocol Version, and implementation digest. The exact identity is checked before every Role Run; a same-named replacement cannot inherit an existing Mission, and the plugin never falls back to an ungated default Provider. During plugin unload the structural owner cancels and quiesces its governed children; a Mission that later lacks its frozen provider blocks with `GOVERNED_PROVIDER_UNAVAILABLE`.
