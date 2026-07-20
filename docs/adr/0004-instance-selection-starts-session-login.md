---
status: accepted
---

# Instance selection starts session login and recovery reuses that session

The controlled recovery request tools are visible by default. Selecting a TaurusDB instance immediately creates a loopback database login link; successful login establishes both the validated in-memory Session Binding and a short-lived HttpOnly browser operator session. Recovery requires that same browser session plus explicit target confirmation, so no recovery secret file or second database credential is configured and an Agent that merely receives the approval URL cannot submit it. Database authorization remains the account owner's responsibility, while the MCP prevents arbitrary writes and independently gates the sole recovery operation.
