# taurusdb-mcp

TaurusDB MCP server for MCP clients such as:

- Claude
- Cursor
- VS Code

## Install

```bash
npm install taurusdb-mcp
```

Run directly with:

```bash
npx taurusdb-mcp --version
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
