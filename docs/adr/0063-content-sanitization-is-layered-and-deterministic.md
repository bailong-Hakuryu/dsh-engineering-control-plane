---
status: accepted
---

# Content Sanitization is layered and deterministic

Before persistence or rendering, the plugin applies a deterministic pipeline covering configured secret environment names, host patterns, known credential formats, bounded high-entropy candidates, invalid encoding, ANSI and OSC controls, terminal hyperlinks, and active presentation content. It records category, location, and digest of each removal but retains no original secret value. Sanitization and Redaction are security controls rather than Reviewer opinions; if they obscure information required for a decision, the corresponding Assurance Result is indeterminate and cannot be waived by model prose or debug mode.
