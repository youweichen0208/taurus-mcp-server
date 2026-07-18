# Security policy

## Supported versions

Security fixes are provided for the latest published minor release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting for this repository:

https://github.com/youweichen0208/taurus-mcp-server/security/advisories/new

Include the affected version, deployment mode, reproduction steps, impact,
and any suggested mitigation. Credentials, SQL contents, approval tokens,
audit logs, and customer identifiers must be removed from the report.

## Operational security

Production deployments must keep mutation and dynamic-target tools disabled
unless explicitly needed, use separate read-only and mutation database users,
require verified TLS, store secrets outside MCP arguments, and retain the
append-only MCP audit log.
