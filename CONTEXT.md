# TaurusDB MCP Harness

This context defines the safety boundary and customer-facing language for a TaurusDB MCP environment that diagnoses databases and advises operators without mutating customer data.

## Language

**Read-only Harness**:
A customer-facing MCP environment that never executes database state changes, regardless of the privileges held by its configured database account.
_Avoid_: Read/write MCP, controlled mutation executor

**Mutation SQL**:
SQL that can change persistent database state, including DML, DDL, DCL, and administrative statements.
_Avoid_: Write query, executable recommendation

**SQL Advice**:
A non-executable SQL proposal intended for human review, supported by available schema and execution-plan evidence but not guaranteed to satisfy business semantics.
_Avoid_: Correct answer, safe-to-run SQL

**Human Execution Boundary**:
The boundary at which the Read-only Harness returns SQL Advice and a customer reviews and executes any resulting Mutation SQL through a separate, customer-controlled database channel.
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
The temporary association of validated database credentials and a selected database target with the current MCP process, bounded by both idle and absolute expiry.
_Avoid_: Saved account, persistent login
