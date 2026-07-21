---
status: accepted
date: 2026-07-20
supersedes: ADR-0004 recovery confirmation portion
---

# Target-bound direct recycle-bin restore

The customer Harness keeps arbitrary DML, DDL, DCL, and administrative SQL unavailable to the
Agent. Recycle-bin restore remains the only database-state exception. After the user asks to restore
an exact object, `restore_recycle_bin_table` verifies that the recycle object exists and that the
explicit destination does not exist, executes the TaurusDB native restore with the active in-memory
session credential, verifies the destination using readonly metadata, and records audit evidence.

The former loopback browser approval and status-request flow is removed. Deployments that require
independent approval, dual control, or centrally authenticated operator identity must disable the
restore tool with `TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE=false` and perform recovery through their
external change-control system.
