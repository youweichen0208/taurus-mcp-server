# Secure Local SQL Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plaintext MCP credential tools with a single-use loopback SQL login page that binds credentials directly into MCP server memory.

**Architecture:** Add a focused loopback HTTP credential service owned by MCP server dependencies. A new `begin_sql_login` tool creates a short-lived token and returns a local URL; form submission binds credentials through the runtime profile loader and rebuilds the engine. Remove plaintext SQL and cloud credential tools from registration.

**Tech Stack:** TypeScript, Node.js `http` and `crypto`, MCP TypeScript SDK, Zod, Node test runner.

---

### Task 1: Build the loopback credential login service

**Files:**
- Create: `packages/mcp/src/security/local-credential-login.ts`
- Create: `packages/mcp/tests/local-credential-login.test.mjs`

- [ ] Write failing tests that create the service, issue a SQL login token, submit form data, and assert the binding callback receives the credentials while responses never contain the password.
- [ ] Add failing tests for invalid tokens, five-minute expiry, repeated submissions, missing fields, `Cache-Control: no-store`, and a `127.0.0.1` login URL.
- [ ] Run `npm run build --workspace taurusdb-mcp && node --test packages/mcp/tests/local-credential-login.test.mjs` and confirm failure because the module does not exist.
- [ ] Implement `LocalCredentialLoginService` using `node:http`, `randomBytes`, an in-memory pending-login map, a five-minute default TTL, and a maximum request-body size.
- [ ] Ensure successful and failed POST responses never interpolate submitted username or password, and consume tokens after a binding attempt.
- [ ] Run the focused test command and confirm all local credential login tests pass.

### Task 2: Integrate login lifecycle into MCP server dependencies

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/src/tools/registry.ts`
- Modify: `packages/mcp/tests/stdio-integration.test.mjs`

- [ ] Add a failing stdio integration assertion that `begin_sql_login` is exposed while `set_sql_credentials` and `set_cloud_access_keys` are absent.
- [ ] Run `npm run build && node --test packages/mcp/tests/stdio-integration.test.mjs` and confirm the tool-list assertion fails.
- [ ] Add `credentialLogin` to `ServerDeps`, construct it during bootstrap, and close it when the MCP transport/server shuts down.
- [ ] Remove plaintext credential tools from `capabilityToolDefinitions` and register `begin_sql_login`.
- [ ] Run the focused integration test and confirm the tool list passes.

### Task 3: Add `begin_sql_login` and direct session binding

**Files:**
- Create: `packages/mcp/src/tools/taurus/sql-login.ts`
- Modify: `packages/mcp/src/tools/taurus/cloud-context.ts`
- Modify: `packages/mcp/tests/tool-handlers.test.mjs`

- [ ] Add failing handler tests asserting `begin_sql_login` resolves the default datasource and returns only `datasource`, `login_url`, and `expires_at`.
- [ ] Add a failing handler/service integration test asserting a successful form submission sets the runtime user and rebuilds the engine.
- [ ] Run `npm run build && node --test packages/mcp/tests/tool-handlers.test.mjs packages/mcp/tests/local-credential-login.test.mjs` and confirm the new tests fail.
- [ ] Move the reusable engine reload operation out of plaintext credential handling and expose the minimum callback needed by `begin_sql_login`.
- [ ] Implement `beginSqlLoginTool` without username or password input fields.
- [ ] Delete `setSqlCredentialsTool` and `setCloudAccessKeysTool` exports and update affected handler tests.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Update guidance and security documentation

**Files:**
- Modify: `packages/core/src/executor/connection-pool.ts`
- Modify: `packages/core/tests/connection-pool.test.mjs`
- Modify: `README.md`
- Modify: `docs/cloud-taurusdb-testing.md`

- [ ] Update the failing connection-pool assertion to require guidance to call `begin_sql_login`.
- [ ] Run `npm run build --workspace taurusdb-core && node --test packages/core/tests/connection-pool.test.mjs` and confirm it fails against the old guidance.
- [ ] Change the missing-credential error to instruct `begin_sql_login`.
- [ ] Replace documented plaintext credential flows with the local login URL flow and state that AK/SK must come from process configuration.
- [ ] Run the focused Core test and confirm it passes.

### Task 5: Verify security behavior and regression coverage

**Files:**
- Modify as required by verification findings only.

- [ ] Run `npm run check` and confirm TypeScript reports no errors.
- [ ] Run `npm test` and confirm all non-environment-dependent tests pass.
- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Inspect `rg -n "set_sql_credentials|set_cloud_access_keys" packages/mcp/src README.md docs/cloud-taurusdb-testing.md` and confirm no supported plaintext credential flow remains.
- [ ] Inspect the final diff to confirm no password is logged, returned, or embedded in URLs.

