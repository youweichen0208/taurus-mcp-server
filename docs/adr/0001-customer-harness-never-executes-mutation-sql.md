---
status: accepted
---

# Customer harness never executes mutation SQL

The customer-facing TaurusDB MCP is a Read-only Harness: it never executes `INSERT`, `UPDATE`, `DELETE`, or other database state changes, even when the configured database account has write privileges. Mutation SQL may be inspected against connected database metadata and returned as SQL Advice, but no configuration switch, confirmation token, or account privilege can enable its execution. At the Human Execution Boundary, the customer reviews the advice and may execute it through a separate customer-controlled database channel; this provides a product-policy boundary independent of database grants, at the cost of excluding controlled write automation from this distribution.

SQL Advice is evidence-backed rather than guaranteed correct. Every mutation recommendation must state that it was not executed, requires human review, identify the database evidence used, disclose its assumptions, and identify business rules that could not be verified from the database.

The harness may automatically build an Impact Preview from schema metadata, indexes, `EXPLAIN`, and `COUNT(*)`. It does not automatically read or return matching business rows; row samples require an explicit customer request through the separately governed read-only query path and remain subject to result limits and redaction.

The no-execution boundary covers every database state change, including DML, DDL, DCL, and administrative statements. The initial advice scope may produce `INSERT`, `UPDATE`, `DELETE`, and evidence-backed `CREATE INDEX` proposals; destructive DDL, permission changes, and global configuration changes may be analyzed and warned about but are not proactively emitted as copy-ready SQL.
