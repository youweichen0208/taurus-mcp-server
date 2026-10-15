# Release readiness

This document is the release gate for the customer-facing TaurusDB MCP
harness. A release tag must not be published until every required gate is
green for the exact commit being tagged.

## Automated gates

All of these run in GitHub Actions for every pull request and again, through
the reusable CI workflow, for the tagged commit in the release workflow:

- `npm ci` with a lockfile that matches every package version
- `npm run check:versions` (root, both workspaces, the exact MCP -> Core
  dependency, the lockfile, and the release tag agree)
- `npm run check` and `npm test` on Node.js 20, 22, and 24 without fail-fast
- `npm audit --omit=dev --audit-level=high` with no ignored advisories
- `npm run pack:check`
- `npm run verify:packed`: both tarballs installed into a clean directory
  outside the repository, then CLI `--version`/`--help`, the packaged Windows
  credential script, and MCP `initialize`/`tools/list`/`ping`
- the local MySQL 8.0 integration harness, which must report zero skipped and
  zero failed tests; it covers mutation advice leaving rows unchanged, the
  function guardrail, the READ ONLY transaction backstop, real `CALL` result
  parsing, login-link revocation, and the `acceptance` command
- concurrency, queue saturation, large-result byte limits, audit rotation, and
  MySQL pressure fixtures described in `docs/scale-validation.md`

Run the MySQL harness locally with Docker:

```bash
docker run -d --name taurus-mcp-mysql-test -e MYSQL_ROOT_PASSWORD=root_test_password \
  -e MYSQL_DATABASE=taurus_mcp_test -p 13306:3306 mysql:8.0
```

Then create the `taurus_ro`/`taurus_rw` users exactly as in
`.github/workflows/ci.yml`, export the `TAURUSDB_TEST_MYSQL_*` variables with
port `13306`, and run `npm run test:mysql`.

## Branching

- `develop` is the default branch. Feature and fix branches merge into it
  through pull requests with green CI.
- Each minor release line has a release branch named `release/<major>.<minor>`
  (for example `release/1.0`), cut from `develop` when the line is stabilized.
  All `v<major>.<minor>.*` tags, including prereleases, are created on it.
- Fixes for a released line land on `develop` first and are then
  cherry-picked onto the release branch, so the two never diverge silently.
  New features are never merged into an existing release branch.
- The next minor version gets a new release branch cut from `develop`.

## Release procedure

1. For a new minor version, cut `release/<major>.<minor>` from a `develop`
   commit with green CI. For a patch, cherry-pick the fixes from `develop` onto
   the existing release branch and bump the patch version there.
2. Wait for CI on the release branch to pass.
3. Confirm the npm trusted publisher for both `taurusdb-core` and
   `taurusdb-mcp`: repository `youweichen0208/taurus-mcp-server`, workflow
   `release.yml`, environment `npm`.
4. Tag the verified release-branch commit as `v<version>` and push the tag. The
   release workflow refuses tags that are not on the matching
   `release/<major>.<minor>` branch or do not match every package version.
5. The workflow packs once, records SHA-256 sums and a CycloneDX SBOM, verifies
   the exact tarballs, publishes `taurusdb-core` and waits for the registry,
   then publishes `taurusdb-mcp`, both with provenance (`latest` for stable
   versions, `next` for prereleases).
6. Re-runs skip only versions already published with byte-identical integrity
   and fail on any difference. Published versions and tags are never replaced.
7. After a clean install from npm passes the MCP handshake and the dist-tag
   check, the workflow creates the GitHub Release with both tarballs, the SBOM,
   `SHA256SUMS`, and the redacted verification records.

## TaurusDB acceptance gate

Since `1.0.0`, local and CI acceptance gate the release, and acceptance against a
real TaurusDB instance runs **after** publication from the installed package.
Its result is recorded separately; problems are fixed in a patch release.

Run it against a disposable TaurusDB instance with the pinned version:

```bash
npx -y taurusdb-mcp@1.0.2 acceptance --instance-id <instance-id> \
  --database <database> \
  --advice-sql "UPDATE <table> SET <column> = <value> WHERE <key> = <id>" \
  --advice-snapshot-sql "SELECT <column> FROM <table> WHERE <key> = <id>" \
  --report acceptance.json
```

See `docs/cloud-taurusdb-testing.md` for environment variables, the optional
disposable recovery check, and how to read the report. The run is accepted only
when every check is `pass`; `pending` means not yet verified.

The acceptance must prove:

- the endpoint is identified as TaurusDB and capability probing works
- datasource/database discovery and a readonly query work
- slow SQL and hotspot diagnostics return a valid evidence-backed or explicitly
  `not_applicable` result
- `analyze_mutation_sql` returns `execution_status: not_executed` and leaves the
  snapshot unchanged
- the published tool list contains no general mutation tool; its only
  database-state mutation is `restore_recycle_bin_table`
- with an explicitly named disposable object, the restore uses the active
  session, matches the exact recycle object, blocks destination collisions,
  writes audit evidence, and passes readonly post-verification
- no secret, credential, endpoint, or customer identifier appears in the report

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
- Retain the package integrity/provenance output, the GitHub Release
  verification records, and the TaurusDB acceptance report with the release
  record.

## Rollback

Rollback means pinning the previous known-good npm version in the MCP client or
harness configuration and restarting the MCP process. A defective published
version is deprecated with `npm deprecate` and superseded by a patch release;
it is never unpublished or overwritten.
