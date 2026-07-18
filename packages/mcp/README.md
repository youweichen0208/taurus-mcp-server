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

Claude Code:

```bash
claude mcp add huaweicloud-taurusdb \
  --transport stdio \
  -e TAURUSDB_CLOUD_REGION=<your-region> \
  -e TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak> \
  -e TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk> \
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
  --env TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak> \
  --env TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk> \
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
- Mutation and dynamic-target tools are disabled by default
- Mutation tools require a dedicated `TAURUSDB_SQL_MUTATION_USER` /
  `TAURUSDB_SQL_MUTATION_PASSWORD` pair and an external operator-signed approval
- MCP audit events are written to `~/.taurusdb-mcp/audit.jsonl` by default

Enable mutations only when required:

```bash
export TAURUSDB_ENABLE_MUTATIONS=true
export TAURUSDB_SQL_MUTATION_USER='<dedicated-writer>'
export TAURUSDB_SQL_MUTATION_PASSWORD='hw-csms://<writer-secret-name>'
export TAURUSDB_MUTATION_APPROVAL_SECRET_FILE='/run/secrets/taurusdb-approval'
```

Sign a returned `approval_request` outside the MCP client:

```bash
npx taurusdb-mcp approve \
  --request '<approval_request>' \
  --actor '<operator-identity>' \
  --secret-file /run/secrets/taurusdb-approval
```
