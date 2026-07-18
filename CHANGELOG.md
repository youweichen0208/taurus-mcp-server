# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

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
