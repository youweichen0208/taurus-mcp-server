# TaurusDB MCP Harness

This context defines the safety boundary and customer-facing language for a TaurusDB MCP environment that diagnoses databases, advises operators, and permits only a narrowly governed recycle-bin recovery exception.

## Language

**Read-only Harness**:
A customer-facing MCP environment whose Agent-facing operating plane cannot execute arbitrary database state changes, regardless of the privileges held by its configured database account. A separately approved Controlled Recovery Exception does not turn the operating plane into a write interface.
_Avoid_: Read/write MCP, general mutation executor

**Controlled Recovery Exception**:
A capability visible by default that restores one explicitly identified recycle-bin table to one non-existing destination when the user asks for it, using an unexpired Session Binding for the currently selected target and complete audit evidence (ADR-0005). There is no separate browser approval step; deployments that need independent approval disable the capability.
_Avoid_: Mutation mode, write access, browser approval

**Recovery Audit Target**:
The immutable record of datasource, instance, endpoint, recycle-bin object, destination database and table, and SQL hash captured before a restore starts; every audit record for that restore (requested, completed, failed, unverified) uses it, even if the session target changes meanwhile.
_Avoid_: Current target at write time

**Mutation SQL**:
SQL that can change persistent database state, including DML, DDL, DCL, and administrative statements.
_Avoid_: Write query, executable recommendation

**SQL Advice**:
A non-executable SQL proposal intended for human review, supported by available schema and execution-plan evidence but not guaranteed to satisfy business semantics.
_Avoid_: Correct answer, safe-to-run SQL

**Human Execution Boundary**:
The boundary at which the Read-only Harness returns SQL Advice and a customer reviews and executes general Mutation SQL through a separate, customer-controlled database channel. It does not apply to the narrowly defined Controlled Recovery Exception.
_Avoid_: MCP confirmation, delegated execution

**Impact Preview**:
A read-only assessment of proposed Mutation SQL based on schema metadata, indexes, an execution plan, and matched-row counts; it excludes business-row samples unless the customer explicitly requests a separately governed preview.
_Avoid_: Dry run, simulated execution

**Index Advice**:
A non-executable `CREATE INDEX` proposal supported by query-plan and existing-index evidence, together with operational cost and rollout risks.
_Avoid_: Automatic index, safe index change

**Local Credential Handoff**:
A loopback-only browser flow that submits database credentials directly to the local MCP process without placing them in Agent-visible conversation content or MCP tool arguments.
_Avoid_: Huawei Cloud login, official login, Agent login

**Neutral Login Page**:
The unbranded user interface for Local Credential Handoff, clearly identified as a local TaurusDB MCP page and not as a Huawei or Huawei Cloud authentication service.
_Avoid_: Huawei login page, official TaurusDB login

**Credential Validation**:
A read-only check that supplied database credentials can establish a usable connection before they are bound to the current MCP session; implementation probes are not exposed as customer-facing login semantics.
_Avoid_: SQL login, `SELECT 1` login

**Session Binding**:
The temporary association of validated database credentials and a selected database target (host, port, instance, region) with the current MCP process, bounded by both idle and absolute expiry; it is the only identity that can run a Controlled Recovery Exception. Configured static credentials never form a Session Binding.
_Avoid_: Saved account, persistent login

**Login Link**:
The single-use local URL issued for Local Credential Handoff. It is bound to the target it was issued for and is revoked when the instance or region changes, credentials are cleared, or a newer link is issued for the same datasource.
_Avoid_: Reusable login page, session token
