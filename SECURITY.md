# Security Policy

## Supported versions

The `0.1.x` line receives security fixes. Older development snapshots are not
supported after a replacement release is available.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue. Before the public
GitHub repository is created, report them privately to the distribution
maintainer. After publication, use the repository's private security-advisory
reporting channel.

Include the affected version, platform, Harness version, reproduction steps,
and the least sensitive evidence needed to validate the issue. Remove tokens,
credentials, repository contents, and personal data.

## Security boundary

The Control Plane governs Mission execution and evidence acceptance but does
not turn untrusted agents, subprocesses, browser clients, or Assurance
Providers into decision authorities. Deployment-owned repository mappings,
verification policy, capability composition, and platform controls remain part
of the trusted host configuration.
