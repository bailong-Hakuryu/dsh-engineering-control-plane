---
status: accepted
---

# Assurance results name the Provider's own assessment

When the Security Assurance gate failed in a real Mission, `mission_status` reported only the Control Plane's own assessment identity (`mission-…:assurance:1:1:assessment:1`) and the reason `eligible_submission`. The model had no way to learn why the Provider failed: it passed the Control Plane identity to `security_assessment_status`, which rejected it. Yet every sealed submission already names the Provider's own assessment in `externalAssessment.assessmentId`.

The Invocation Coordinator now passes that identity to the Kernel when it settles a sealed submission, provided it is a plain reference (`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`); an unusual identity is simply not carried and never blocks settling. The Kernel rejects a malformed one as invalid evidence, records a valid one on the settled invocation, and copies it to the Kernel-owned Assessment and to the Assurance Result as `externalAssessmentIds`. `mission_status` and the Mission card show it beside the requirement and outcome.

The identity is a pointer, not authority: eligibility, outcomes, and the Gate are unchanged, and the Control Plane still interprets nothing in the Provider's domain. A caller reads the Provider's reasons with that Provider's own tools. The fields are optional, so Missions recorded before this change remain valid and simply show no Provider identity.
