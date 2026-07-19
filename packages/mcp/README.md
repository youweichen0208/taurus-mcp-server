# taurusdb-mcp

TaurusDB MCP server for MCP clients such as:

- Claude Code
- Codex
- Cursor
- VS Code

## Install

```bash
npm install taurusdb-mcp
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
  -e TAURUSDB_ENABLE_DYNAMIC_TARGETS=true \
  -e TAURUSDB_SQL_DATABASE=<your-database> \
  -e TAURUSDB_SQL_USER=<your-readonly-user> \
  -e TAURUSDB_SQL_PASSWORD='hw-kms-file:~/.taurusdb-mcp/password.ciphertext' \
  -- npx -y taurusdb-mcp
```

Codex:

```bash
codex mcp add huaweicloud-taurusdb \
  --env TAURUSDB_CLOUD_REGION=<your-region> \
  --env TAURUSDB_CLOUD_KEYCHAIN_SERVICE=taurusdb-mcp/huaweicloud \
  --env TAURUSDB_ENABLE_DYNAMIC_TARGETS=true \
  --env TAURUSDB_SQL_DATABASE=<your-database> \
  --env TAURUSDB_SQL_USER=<your-readonly-user> \
  --env TAURUSDB_SQL_PASSWORD='hw-kms-file:~/.taurusdb-mcp/password.ciphertext' \
  -- npx -y taurusdb-mcp
```

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
- Database passwords support `env:`, `file:`, `hw-csms:`, `hw-kms:`, and `hw-kms-file:` references
- Huawei DEW CSMS is recommended when the database password should be stored and retrieved from Huawei Cloud
- macOS Keychain, Linux Secret Service, or Windows Credential Manager cloud identity is enabled with `TAURUSDB_CLOUD_KEYCHAIN_SERVICE`
- SQL TLS with certificate verification is required by default
- Database mutation tools do not exist; the MCP remains read-only regardless of database account privileges
- `analyze_mutation_sql` returns evidence-backed SQL Advice with `execution_status: not_executed`
- Local SQL login validates the connection before binding credentials, allows at most three attempts per five-minute link, and never sends the password through Agent-visible tool arguments
- Session SQL credentials expire after 30 idle minutes and eight absolute hours; administrators may shorten these limits with `TAURUSDB_SQL_CREDENTIAL_IDLE_TTL_MINUTES` and `TAURUSDB_SQL_CREDENTIAL_MAX_TTL_MINUTES`
- MCP audit events are written to `~/.taurusdb-mcp/audit.jsonl` by default, with
  configurable size rotation for collection into centralized immutable storage
- Run one stdio process per customer/client trust boundary; this package is not
  a shared multi-tenant HTTP service

Customers execute reviewed `advised_sql` through their own controlled change process;
the MCP never executes database state changes.
