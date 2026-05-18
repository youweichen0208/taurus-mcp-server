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
  -e TAURUSDB_SQL_DATABASE=<your-database> \
  -e TAURUSDB_SQL_USER=<your-readonly-user> \
  -e TAURUSDB_SQL_PASSWORD=<your-readonly-password> \
  -- npx -y taurusdb-mcp
```

Codex:

```bash
codex mcp add huaweicloud-taurusdb \
  --env TAURUSDB_CLOUD_REGION=<your-region> \
  --env TAURUSDB_CLOUD_ACCESS_KEY_ID=<your-ak> \
  --env TAURUSDB_CLOUD_SECRET_ACCESS_KEY=<your-sk> \
  --env TAURUSDB_SQL_DATABASE=<your-database> \
  --env TAURUSDB_SQL_USER=<your-readonly-user> \
  --env TAURUSDB_SQL_PASSWORD=<your-readonly-password> \
  -- npx -y taurusdb-mcp
```

Initialize local MCP client config:

```bash
npx taurusdb-mcp init --client claude
npx taurusdb-mcp init --client cursor
npx taurusdb-mcp init --client vscode
```

## Notes

- Requires Node.js `>= 20`
- Depends on `taurusdb-core`
