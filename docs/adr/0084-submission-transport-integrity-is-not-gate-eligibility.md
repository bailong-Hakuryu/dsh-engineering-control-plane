---
status: accepted
---

# Submission transport integrity is not Gate eligibility

Assurance Submission V1 carries credential-free, schema-labelled Provider Composition, Policy, Coverage, Source Seal, Provenance, and Evidence artifacts inside one canonically digested payload. The Control Plane validates exact Invocation, Mission, Attempt, Provider, Subject, and Effective Policy bindings, verifies every artifact and payload digest, and imports the detached value into its own Evidence Store before atomically settling the Invocation. The Submission Digest proves transport integrity only: the Provider's claimed outcome and opaque Source Seal cannot produce an Assurance Result or Quality Gate credit until a frozen Requirement evaluator validates composition, coverage, evidence, assessor eligibility, and the post-implementation Subject.

Credential detection is an import-boundary eligibility check over Provider-controlled metadata and artifact values, not part of the stable Evidence canonicalization codec. Host-frozen structural binding identifiers are never interpreted as credentials, existing Evidence remains readable under its original redaction rules, and explicit cryptographic fields such as a Source Seal signature remain valid. A fixed UTF-8 digest vector defines the cross-plugin canonical byte contract.

Provider factory single-flight is process-local. The Kernel's durable compare-and-swap remains the authority that prevents more than one host process from calling `assess()` for a prepared Invocation; a deployment must not treat Provider factory construction itself as an externally committed assessment.
