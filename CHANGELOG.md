# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Changed

- The local SQL login page now defaults to Chinese regardless of the browser
  language and offers a 中文 / English switch; the chosen language is kept
  through form submission and validation errors (`?lang=en`).

## [1.0.0] - 2026-10-13

First stable release of `taurusdb-core` and `taurusdb-mcp`.

### Release status

- Local and CI acceptance is complete: type checks, unit tests on Node 20, 22,
  and 24, a zero-skip MySQL 8.0 integration suite, a production dependency
  audit with no findings, and installation of the packed tarballs outside the
  workspace.
- **Acceptance against a real TaurusDB instance is still pending.** It is run
  after publication with `taurusdb-mcp acceptance` (see
  `docs/cloud-taurusdb-testing.md`). Issues found there ship as patch releases.

### Defaults to review before deployment

- Database TLS is **off** by default (`TAURUSDB_REQUIRE_TLS=false`) for
  compatibility with dynamically selected public IPs. Production deployments
  should set `TAURUSDB_REQUIRE_TLS=true` with a trusted CA and hostname
  verification.
- `restore_recycle_bin_table` is **enabled** by default and restores directly,
  without a separate approval step (ADR-0005). Deployments that require
  independent approval must set `TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE=false`.

### Security

- Local login links are bound to the target (host, port, instance, region)
  they were issued for and are re-validated under the session lock before
  credentials are used. Switching instance or region, clearing credentials, or
  issuing a newer link revokes outstanding links.
- Login links are claimed before the request body is read and stay claimed
  through failure backoff; connection failures are rate limited as well as
  authentication failures.
- `restore_recycle_bin_table` requires an unexpired in-memory login session
  bound to the currently selected target and returns `SQL_SESSION_REQUIRED`
  otherwise. Configured static credentials no longer authorize a restore.
- Recovery audit records share one immutable target captured before execution
  and now include requested, completed, failed, and unverified outcomes with
  the recycle object and destination. A failed request audit stops the restore;
  uncertain post-execution state returns `RECOVERY_STATE_UNCERTAIN`.
- SQL may call only an allowlist of side-effect-free built-in functions.
  User-defined, schema-qualified, and unresolved functions are blocked (`R010`)
  in readonly queries, EXPLAIN, and Impact Preview.
- `analyze_mutation_sql` runs its derived COUNT and EXPLAIN through the same
  guardrail and reports `impact_analysis.evidence_gaps` instead of executing
  unsafe predicates such as `GET_LOCK` or `SLEEP`.
- Readonly queries and EXPLAIN of queries run inside `START TRANSACTION READ
  ONLY`; a session whose rollback fails is discarded instead of being pooled.
  EXPLAIN of INSERT/UPDATE/DELETE runs outside the transaction because MySQL
  rejects it there; it never executes the DML and remains function-restricted.

### Fixed

- Stored procedure results returned by mysql2 as nested result sets are parsed
  correctly. Recycle-bin preflight matches explicit object identifier columns
  only and fails closed on unrecognized result shapes.
- `npm ci` failed because the lockfile still referenced `taurusdb-core@0.5.0-rc.10`.

### Added

- `taurusdb-mcp acceptance` runs post-install checks over MCP stdio with
  redacted output; unexecuted or unconfigured checks are reported as pending.
- `taurusdb-mcp --help`.

### Changed

- Upgraded `mysql2` to 3.24.5 and `@modelcontextprotocol/sdk` to 1.32.1, and
  resolved transitive advisories in `hono`, `proxy-addr`, `ip-address`, and `qs`.
- Releases publish the exact verified tarballs with provenance, SHA-256 sums,
  and a CycloneDX SBOM, and never overwrite an existing npm version.

## [0.5.0-rc.11] - 2026-07-21

### Fixed

- Flashback Query capability detection now compares the TaurusDB kernel version
  returned by `taurus_version()` instead of the MySQL-compatible `VERSION()` value.
- Missing historical Flashback views now return `FLASHBACK_VIEW_UNAVAILABLE`
  instead of being misreported as database connection failures.

## [0.5.0-rc.10] - 2026-07-20

### Changed

- Recycle-bin recovery now executes directly from `restore_recycle_bin_table` after exact-object
  and destination-collision preflight, then performs readonly post-verification and audit logging.
- Removed the browser recovery approval/status flow and the login-page secure-session badge.

## [0.5.0-rc.9] - 2026-07-20

### Changed

- SQL connections now default to plaintext transport for compatibility with
  dynamically selected public IPs. Operators can restore encrypted transport
  with `TAURUSDB_REQUIRE_TLS=true` and strict certificate-chain and hostname
  verification through datasource `tls.rejectUnauthorized: true`.

## [0.5.0-rc.8] - 2026-07-20

### Added

- Credential-free TCP endpoint preflight before issuing a local SQL login link,
  with actionable security-group, network ACL, VPN, and outbound firewall hints.

### Changed

- Database endpoint, refused-port, TLS, authentication, and validation-timeout
  failures now use distinct customer-facing messages and structured error codes;
  database validation failures no longer return a generic HTTP 504 response.
- The local database login page now uses a consistent target-context grid,
  full monospaced instance identifiers, aligned region/datasource values, a
  restrained console-red visual system, and clearer credential field spacing
  across desktop and mobile layouts.
- Recoverable database validation failures now render their structured error
  code, explanation, and next action directly in the login page with HTTP 200,
  preventing embedded browser views from replacing them with generic status pages.

## [0.5.0-rc.7] - 2026-07-20

### Fixed

- Interactive cloud instance selection now binds only the instance read/write
  public IP. Instances without a public IP fail immediately instead of binding
  an unreachable VPC-private address and timing out from a local MCP client.

## [0.5.0-rc.6] - 2026-07-20

### Fixed

- Local SQL login now accepts sandboxed browser `Origin: null` requests and
  loopback aliases such as `localhost` when they target the active local port.

### Security

- Local SQL login now validates the request Host, loopback address, and active
  listener port while continuing to reject non-loopback browser origins.

## [0.5.0-rc.5] - 2026-07-20

### Fixed

- Dynamic target and local login tools are now enabled by default, so selecting
  a TaurusDB instance returns `login_url` without requiring an extra feature flag.
- Customer configuration examples no longer require
  `TAURUSDB_ENABLE_DYNAMIC_TARGETS=true` for the standard interactive flow.

## [0.5.0-rc.4] - 2026-07-20

### Added

- Human-gated TaurusDB recycle-bin recovery with readonly preflight, explicit
  destination binding, single-use local confirmation, audit evidence, and
  readonly post-restore verification.
- An Agent-invisible HttpOnly browser operator session established by successful
  database login and required for recovery confirmation.

### Changed

- `select_cloud_taurus_instance` now returns a short-lived local database login
  URL immediately after binding the selected instance.
- Interactive customers no longer need database usernames, passwords, recovery
  credentials, or recovery approval secret files in MCP configuration.
- Controlled recovery request and status tools are visible by default; arbitrary
  DML, DDL, DCL, administrative SQL, and direct restore tools remain unavailable.

### Security

- Recovery confirmation must come from the same browser that completed database
  login; switching targets or clearing/expiring credentials revokes that browser
  authorization.
- Recovery remains target-bound, rejects destination collisions and target
  changes, and fails closed when durable audit evidence cannot be written.

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
