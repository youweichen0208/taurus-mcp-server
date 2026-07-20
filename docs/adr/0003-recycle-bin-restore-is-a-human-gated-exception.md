---
status: superseded by ADR-0004
---

# Recycle-bin restore is a human-gated exception

The customer Harness keeps its Agent-facing operating plane read-only and never exposes arbitrary DML, DDL, DCL, or administrative SQL. The sole database-state exception is restoration of one explicitly identified TaurusDB recycle-bin table to one explicitly named, non-existing destination. Recovery is disabled by default, uses a dedicated recovery credential, requires a separate Agent-invisible approval secret plus short-lived single-use confirmation in a loopback-only operator page, executes directly from that local approval path rather than from an Agent-held token, verifies the destination after execution, and writes operator-attributed audit evidence. General SQL Advice remains subject to the Human Execution Boundary.

Direct Agent execution, a generic mutation feature flag, reusable approval tokens, `insert_select` recovery, and overwriting an existing destination were rejected because they would turn a narrow disaster-recovery control into a general write surface.
