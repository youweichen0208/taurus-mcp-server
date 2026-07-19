---
status: accepted
---

# Validate local credentials and expire session bindings

Local Credential Handoff validates supplied credentials with a fixed read-only connection probe before creating a Session Binding; the customer-facing page reports connection validation rather than exposing the probe SQL. A binding expires after 30 minutes of database inactivity and no later than 8 hours after creation, at which point credentials are cleared and associated pools are closed. Administrators may shorten these limits but cannot disable expiry, trading occasional reauthentication for a bounded period in which a long-running MCP process retains database credentials.

The Neutral Login Page uses browser language negotiation for Simplified Chinese or English and explains that credentials go directly to the local MCP service, are absent from Agent conversation and MCP tool arguments, and are not persisted by MCP.

Each login link is valid for five minutes and permits at most three credential failures. It is consumed immediately after successful validation or the third credential failure; failures use increasing delays and do not reveal whether the username or password was incorrect. Connectivity failures are distinguished from credential failures without exposing driver details and remain rate-limited.
