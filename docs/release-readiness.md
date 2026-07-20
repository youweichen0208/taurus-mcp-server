# Release readiness

This document is the release gate for the customer-facing TaurusDB MCP
harness. A release tag must not be published until every required gate is
green for the exact commit being tagged.

## Automated gates

- `npm ci`
- `npm run check`
- `npm test`
- local MySQL MCP integration harness proving mutation advice leaves rows unchanged
- `npm audit --omit=dev --audit-level=high`
- `npm run pack:check`
- installation and CLI smoke test from the generated `taurusdb-core` and
  `taurusdb-mcp` tarballs
- concurrency, queue saturation, large-result byte limits, audit rotation, and
  MySQL pressure fixtures described in `docs/scale-validation.md`

GitHub Actions runs the unit/contract matrix on Node.js 20 and 22 and runs the
local MySQL harness in a separate job. The release workflow repeats the release
checks and publishes both packages with npm provenance.

## Required TaurusDB release-candidate gate

Run the following against a disposable TaurusDB instance using the exact
release candidate:

```bash
npm ci
npm run build
npm run cloud:validate
```

Required environment:

- a static datasource profile with a verified TLS endpoint and read-only user
- Huawei Cloud project, region, instance, and node context
- credentials with only the documented read/diagnostic permissions
- `TAURUSDB_CLOUD_VALIDATE_DATABASE`
- optional disposable table and explain SQL inputs

The validator must prove:

- the endpoint is identified as TaurusDB
- SQL TLS negotiated a non-empty cipher
- datasource/database discovery and a readonly query work
- explain and capability probing work
- slow SQL, service-latency, and replication diagnostics return a valid
  evidence-backed or explicitly `not_applicable` result
- no secret, raw SQL, credential, or customer identifier appears in stdout
  or stderr
- `analyze_mutation_sql` returns `execution_status: not_executed`, schema/plan
  evidence where available, no sampled business rows, and leaves the target table
  unchanged
- the default published tool list contains no general mutation or direct restore tool;
  its only recovery surface is `prepare_recycle_bin_restore` and
  `get_recycle_bin_restore_status`, including when legacy mutation variables are present
- with a browser operator session established by database login, the disposable
  TaurusDB gate proves target collision blocking, single-use local approval,
  Agent-invisible HttpOnly browser session, active session credentials, operator audit,
  and readonly post-verification

## Operational acceptance

- Use a private TaurusDB address by default.
- Run one MCP process per customer/session trust boundary.
- Dynamic-target tools are enabled by default for interactive customer login;
  explicitly disable them for fixed static harnesses.
- Mount secret and audit paths from the host; do not place secrets in tool
  arguments.
- Ship audit logs to append-only centralized storage and alert on
  `AUDIT_FAILED`, queue saturation, and TLS failures.
- Validate audit rotation, collector checkpoint/retry, centralized retention,
  disk-space alerts, and the single-process trust boundary in
  `docs/customer-deployment.md`.
- Document read-only grants, optional recovery privilege on the session account, the external human
  execution boundary, and the controlled recycle-bin recovery exception.
- Retain the package integrity/provenance output and the RC validation log with
  the release record.

## Rollback

Rollback means pinning the previous known-good npm version in the MCP client or
harness configuration and restarting the MCP process.
