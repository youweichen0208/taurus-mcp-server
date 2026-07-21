# taurusdb-mcp

TaurusDB MCP server for MCP clients such as:

- Claude Code
- Codex
- Cursor
- VS Code

## Install

```bash
npm install taurusdb-mcp@latest
```

Run directly with:

```bash
npx -y taurusdb-mcp --version
```

Use this command in MCP client configs:

```json
{
  "command": "npx",
  "args": ["-y", "taurusdb-mcp"]
}
```

Configure Huawei Cloud identity through the operating-system credential store
before adding the server. AK/SK values should not be copied into MCP client
configuration:

```bash
npx -y taurusdb-mcp credentials configure
TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  npx -y taurusdb-mcp credentials check
```

Claude Code:

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -e TAURUSDB_CLOUD_REGION=<your-region> \
  -e TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  -- npx -y taurusdb-mcp
```

Codex:

```bash
codex mcp add huaweicloud-taurusdb \
  --env TAURUSDB_CLOUD_REGION=<your-region> \
  --env TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  -- npx -y taurusdb-mcp
```

Interactive connection flow:

1. Call `list_cloud_taurus_instances`.
2. Call `select_cloud_taurus_instance`.
3. Open the returned `login_url` in a browser and enter the database credentials.
4. Continue with `list_databases`, `set_default_database`, and readonly tools.

The browser submits credentials directly to the loopback MCP process. They are not
sent through Agent-visible tool arguments or persisted by MCP.

Initialize local MCP client config:

```bash
npx taurusdb-mcp init --client claude
npx taurusdb-mcp init --client cursor
npx taurusdb-mcp init --client vscode
```

Configure and verify the operating-system credential store:

```bash
npx taurusdb-mcp credentials configure
npx taurusdb-mcp credentials check
```

## Notes

- Requires Node.js `>= 20`
- Depends on `taurusdb-core`
- Interactive clients do not need database usernames or passwords in MCP configuration
- Unattended static deployments may use `env:`, `file:`, `hw-csms:`, `hw-kms:`, or `hw-kms-file:` password references
- macOS Keychain, Linux Secret Service, or Windows Credential Manager cloud identity is enabled with `TAURUSDB_CLOUD_KEYCHAIN_SERVICE`
- SQL TLS with certificate verification is required by default
- General database mutation tools do not exist; the Agent-facing operating plane remains read-only regardless of database account privileges
- `restore_recycle_bin_table` is visible by default and directly restores one exact recycle-bin object to one explicit non-existing destination after readonly preflight; it uses the active in-memory SQL session, post-verifies the destination, and writes audit evidence without a browser approval step
- `analyze_mutation_sql` returns evidence-backed SQL Advice with `execution_status: not_executed`
- Selecting a cloud instance returns a local SQL login link immediately; login validates the connection before binding credentials, allows at most three attempts per five-minute link, and never sends the password through Agent-visible tool arguments
- Interactive instance selection binds the read/write public IP and fails immediately when the instance has no public IP; it never falls back to a VPC-private address that a local MCP client cannot route to
- Before issuing a login link, instance selection performs a credential-free TCP endpoint preflight and returns actionable security-group/network guidance when the public database port is unreachable
- Login validation distinguishes unreachable endpoint, refused port, TLS, authentication, and database validation timeout failures instead of returning a generic HTTP 504
- Recoverable login errors render their structured code and remediation directly in the browser page with HTTP 200 so embedded webviews do not hide the message; cross-origin requests remain blocked with HTTP 403
- Instance selection and local login tools are enabled by default; fixed static deployments may set `TAURUSDB_ENABLE_DYNAMIC_TARGETS=false`
- Session SQL credentials expire after 30 idle minutes and eight absolute hours; administrators may shorten these limits with `TAURUSDB_SQL_CREDENTIAL_IDLE_TTL_MINUTES` and `TAURUSDB_SQL_CREDENTIAL_MAX_TTL_MINUTES`
- MCP audit events are written to `~/.taurusdb-mcp/audit.jsonl` by default, with
  configurable size rotation for collection into centralized immutable storage
- Run one stdio process per customer/client trust boundary; this package is not
  a shared multi-tenant HTTP service

Customers execute reviewed general-purpose `advised_sql` through their own controlled
change process. The only MCP database-state exception is the target-bound,
same-browser-confirmed recycle-bin recovery described above.
