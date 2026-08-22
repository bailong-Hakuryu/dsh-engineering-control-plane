---
status: accepted
---

# External assurance is imported by value

The Control Plane does not share a database or writable Evidence path with external Assurance Providers. It validates a provider's immutable digest-bound Assurance Submission and imports the Evidence snapshot required to reproduce its own Assurance Result, so later provider loss or mutation cannot alter a recorded Mission decision.
