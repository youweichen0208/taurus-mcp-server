---
status: partially superseded by ADR-0005
---

# Instance selection starts session login and recovery reuses that session

Selecting a TaurusDB instance immediately creates a loopback database login link and successful login establishes the validated in-memory Session Binding. The browser-operator recovery confirmation portion of this decision was superseded by ADR-0005. Database authorization remains the account owner's responsibility, while the MCP prevents arbitrary writes except for the target-bound recycle-bin restore.
