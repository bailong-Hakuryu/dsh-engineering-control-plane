---
status: accepted
---

# Evidence content is untrusted UI input

All Evidence Views, Reviewer prose, command summaries, and raw diagnostic JSON are treated as untrusted browser input. The Web client renders an allowlisted Markdown subset with raw HTML, scripts, frames, remote images, dangerous URI schemes, and content-created executable controls disabled. Repository file navigation is offered only after the host revalidates a canonical repository-relative path and remains a read-only navigation action. Size limits and Redaction apply before rendering, so a valid Evidence digest never implies that its presentation is safe.
