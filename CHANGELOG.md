# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

## [Unreleased]

## [0.5.0-rc.3] - 2026-07-19

### Added

- A neutral, responsive local database login page with Chinese/English language
  negotiation and masked instance, region, and datasource context.
- Read-only credential validation before session binding, bounded retries, and
  a real-MySQL integration scenario for the browser login flow.
- `analyze_mutation_sql`, which returns schema-, EXPLAIN-, and safe COUNT-backed
  SQL Advice while always reporting `execution_status: not_executed`.

### Changed

- The customer-facing MCP is now a strictly read-only Harness. Database mutation
  and recycle-bin restore tools were removed, and legacy mutation flags can no
  longer re-enable them.
- Mutation execution documentation was archived and replaced by the human
  execution boundary defined in ADR-0001.

### Security

- Session SQL credentials now expire after 30 idle minutes and eight absolute
  hours; administrators may shorten but cannot disable these limits.
- Local login submissions are single-flight, cross-origin protected, and
  return sanitized credential, connectivity, TLS, and timeout failures.
- Selecting a default database now verifies read-only schema access before the
  session target is changed.
- SQL account privileges, configuration, and approval tokens cannot grant the
  MCP a database state-change tool.

## [0.5.0-rc.2] - 2026-07-19

### Fixed

- CLI version output now reads the published package metadata instead of a
  hard-coded value.
- Release automation uses an OIDC-capable Node.js and npm CLI combination.

## [0.5.0-rc.1] - 2026-07-19

### Added

- Bounded audit log rotation with private permissions and concurrent-write
  integrity coverage.
- Deterministic concurrency, queue saturation, large-result, and MySQL scale
  validation.
- Customer deployment, centralized audit handoff, and release verification
  guidance.

### Changed

- Customer configuration examples now prefer the operating-system credential
  store and no longer contain developer-specific paths or addresses.
- Development tooling was updated to remove the remaining npm audit advisory.

### Fixed

- MySQL integration tests now execute in CI instead of being silently skipped.
- Restored version-controlled MySQL fixtures and use the mutation account for
  lock-contention workloads.

## [0.4.0] - 2026-07-18

### Added

- External operator-signed, one-time mutation approvals.
- Dedicated read-only and mutation credentials.
- Durable JSONL audit logging with actor and target context.
- Strict TLS defaults, cloud endpoint allowlisting, bounded query concurrency,
  and byte/BLOB result limits.
- Atomic session target switching and private-address preference.

### Changed

- Mutation and dynamic-target tools are disabled by default.
- Database names containing hyphens are quoted safely.

### Security

- Cross-database SQL is blocked.
- Side-effecting SELECT variants are blocked.
- Sensitive source columns remain masked when projected through aliases.
