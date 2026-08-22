---
status: accepted
---

# Network authorization is revalidated per hop

A reviewable Network Action binds normalized scheme, host, port, method, purpose, request-body digest, and resolution state. TLS is the default, and every DNS resolution and redirect target is independently normalized and passed through the Action Gate; approving the initial URL never authorizes a redirect. Loopback, private, link-local, and metadata destinations are product-denied unless an explicit specialized Action Kind exists. Request size, response size, duration, and redirect count are bounded, while credentials, cookies, authorization headers, tokens, and sensitive bodies are excluded from Reviewer inputs and ordinary logs.
