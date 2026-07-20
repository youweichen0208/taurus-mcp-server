# TaurusDB MCP Harness

This context defines the safety boundary and customer-facing language for a TaurusDB MCP environment that diagnoses databases, advises operators, and permits only a narrowly governed recycle-bin recovery exception.

## Language

**Read-only Harness**:
A customer-facing MCP environment whose Agent-facing operating plane cannot execute arbitrary database state changes, regardless of the privileges held by its configured database account. A separately approved Controlled Recovery Exception does not turn the operating plane into a write interface.
_Avoid_: Read/write MCP, general mutation executor

**Controlled Recovery Exception**:
A capability visible by default that restores one explicitly identified recycle-bin table to one non-existing destination only after confirmation from the browser session established by Local Credential Handoff, using the active Session Binding and complete audit evidence.
_Avoid_: Mutation mode, Agent restore, write access

**Recovery Request**:
A short-lived, single-use proposal binding a datasource, recycle-bin object, destination database, and destination table to a local operator approval page.
_Avoid_: Confirmation token, reusable approval

**Recovery Operator**:
The human who reviews and confirms a Recovery Request outside the Agent-facing tool call; their asserted identity is recorded in the audit trail.
_Avoid_: Agent approver, self-confirmation

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
The temporary association of validated database credentials and a selected database target with the current MCP process, bounded by both idle and absolute expiry; it is also the execution identity for an approved Controlled Recovery Exception.
_Avoid_: Saved account, persistent login
