# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

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
