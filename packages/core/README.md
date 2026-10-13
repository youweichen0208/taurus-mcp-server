# taurusdb-core

Shared TaurusDB data-plane engine for:

- schema discovery
- readonly and mutation SQL execution
- SQL guardrails and external operator-signed approval flow
- TaurusDB capability detection
- diagnostics workflows

## Install

```bash
npm install taurusdb-core
```

## Notes

- Requires Node.js `>= 20`
- This is the shared engine package
- Most end users should install `taurusdb-mcp` instead
- Least-privilege credentials, bounded results, a side-effect-free function
  allowlist, READ ONLY transactions for readonly SQL, and JSONL auditing are
  enabled by default; database TLS is off by default and should be enabled
  with `TAURUSDB_REQUIRE_TLS=true` in production
