import assert from "node:assert/strict";
import test from "node:test";

import { BrowserOperatorSessionStore } from "../dist/security/browser-operator-session.js";
import { LocalCredentialLoginService } from "../dist/security/local-credential-login.js";
import { LocalRecoveryApprovalService } from "../dist/security/local-recovery-approval.js";

const target = {
  datasource: "db-1",
  recycleTable: "RECYCLE_orders_123",
  destinationDatabase: "app-db",
  destinationTable: "orders_restored",
};

async function submit(url, fields, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

function createAuthorizedService(options = {}) {
  const operatorSessions = new BrowserOperatorSessionStore({ now: options.now });
  const cookie = operatorSessions.issue(target.datasource).split(";", 1)[0];
  return {
    cookie,
    service: new LocalRecoveryApprovalService({ ...options, operatorSessions }),
  };
}

test("local recovery page binds an explicit target and warns about state change", async () => {
  const { service, cookie } = createAuthorizedService();
  try {
    const issued = await service.issue({ target, execute: async () => ({ queryId: "q1", affectedRows: 1, verified: true }) });
    const response = await fetch(issued.approvalUrl, { headers: { "accept-language": "zh-CN", cookie } });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /form-action 'self'/);
    assert.match(body, /确认回收站恢复/);
    assert.match(body, /RECYCLE_orders_123/);
    assert.match(body, /app-db\.orders_restored/);
    assert.match(body, /唯一受控例外/);
    assert.doesNotMatch(body, /恢复审批码/);
  } finally {
    await service.close();
  }
});

test("invalid local confirmation never executes recovery", async () => {
  let executions = 0;
  const { service, cookie } = createAuthorizedService();
  try {
    const issued = await service.issue({
      target,
      execute: async () => { executions += 1; return { queryId: "q1", affectedRows: 1, verified: true }; },
    });
    const response = await submit(issued.approvalUrl, {
      operator: "operator@example.com",
      confirmation: "RESTORE wrong.table",
    }, { cookie });
    assert.equal(response.status, 400);
    assert.equal(executions, 0);
    assert.equal(service.getStatus(issued.requestId).status, "pending");
  } finally {
    await service.close();
  }
});

test("valid operator confirmation executes once and records status", async () => {
  const executions = [];
  const { service, cookie } = createAuthorizedService();
  try {
    const issued = await service.issue({
      target,
      execute: async (operator, requestId) => {
        executions.push({ operator, requestId });
        return { queryId: "qry_restore", affectedRows: 1, verified: true };
      },
    });
    const fields = {
      operator: "operator@example.com",
      confirmation: "RESTORE app-db.orders_restored",
    };
    const response = await submit(issued.approvalUrl, fields, { cookie });
    assert.equal(response.status, 200);
    assert.equal((await submit(issued.approvalUrl, fields, { cookie })).status, 410);
    assert.deepEqual(executions, [{ operator: "operator@example.com", requestId: issued.requestId }]);
    assert.deepEqual(service.getStatus(issued.requestId).result, {
      queryId: "qry_restore",
      affectedRows: 1,
      verified: true,
    });
    assert.equal(service.getStatus(issued.requestId).status, "succeeded");
  } finally {
    await service.close();
  }
});

test("database login browser session authorizes recovery without a configured secret file", async () => {
  const operatorSessions = new BrowserOperatorSessionStore();
  const login = new LocalCredentialLoginService({
    failureDelayMs: 0,
    operatorSessions,
  });
  const recovery = new LocalRecoveryApprovalService({ operatorSessions });
  let executions = 0;
  try {
    const loginRequest = await login.issueSqlLogin({
      datasource: target.datasource,
      target: { datasource: target.datasource },
      bind: async () => {},
    });
    const loginResponse = await submit(loginRequest.loginUrl, {
      username: "db_user",
      password: "pwd",
    });
    const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    const issued = await recovery.issue({
      target,
      execute: async () => {
        executions += 1;
        return { queryId: "q1", affectedRows: 1, verified: true };
      },
    });
    assert.equal((await fetch(issued.approvalUrl, { headers: { cookie } })).status, 200);
    const approved = await submit(issued.approvalUrl, {
      operator: "operator@example.com",
      confirmation: "RESTORE app-db.orders_restored",
    }, { cookie });
    assert.equal(approved.status, 200);
    assert.equal(executions, 1);
  } finally {
    await Promise.all([login.close(), recovery.close()]);
  }
});

test("recovery request expires without execution", async () => {
  let now = 1_000;
  let executions = 0;
  const { service, cookie } = createAuthorizedService({ now: () => now, ttlMs: 50 });
  try {
    const issued = await service.issue({
      target,
      execute: async () => { executions += 1; return { queryId: "q1", affectedRows: 1, verified: true }; },
    });
    now += 51;
    assert.equal((await fetch(issued.approvalUrl, { headers: { cookie } })).status, 410);
    assert.equal(service.getStatus(issued.requestId).status, "expired");
    assert.equal(executions, 0);
  } finally {
    await service.close();
  }
});

test("recovery page rejects cross-origin approval", async () => {
  let executions = 0;
  const { service, cookie } = createAuthorizedService();
  try {
    const issued = await service.issue({
      target,
      execute: async () => { executions += 1; return { queryId: "q1", affectedRows: 1, verified: true }; },
    });
    const response = await submit(issued.approvalUrl, {
      operator: "operator@example.com",
      confirmation: "RESTORE app-db.orders_restored",
    }, { origin: "https://attacker.example", cookie });
    assert.equal(response.status, 403);
    assert.equal(executions, 0);
  } finally {
    await service.close();
  }
});

test("recovery failure does not expose internal database errors to the Agent", async () => {
  const { service, cookie } = createAuthorizedService();
  try {
    const issued = await service.issue({
      target,
      execute: async () => { throw new Error("private host 10.0.0.8 failed with secret detail"); },
    });
    const response = await submit(issued.approvalUrl, {
      operator: "operator@example.com",
      confirmation: "RESTORE app-db.orders_restored",
    }, { cookie });
    const body = await response.text();
    const status = service.getStatus(issued.requestId);
    assert.equal(response.status, 500);
    assert.equal(status.status, "failed");
    assert.doesNotMatch(status.error, /10\.0\.0\.8|secret detail/);
    assert.doesNotMatch(body, /10\.0\.0\.8|secret detail/);
  } finally {
    await service.close();
  }
});

test("recovery approval requires the browser session established by database login", async () => {
  let executions = 0;
  const operatorSessions = new BrowserOperatorSessionStore();
  const service = new LocalRecoveryApprovalService({ operatorSessions });
  try {
    const issued = await service.issue({
      target,
      execute: async () => { executions += 1; return { queryId: "q1", affectedRows: 1, verified: true }; },
    });
    const response = await submit(issued.approvalUrl, {
      operator: "operator@example.com",
      confirmation: "RESTORE app-db.orders_restored",
    });
    assert.equal(response.status, 401);
    assert.equal(executions, 0);
  } finally {
    await service.close();
  }
});

test("recovery approval locks and invalidates a request after three failures", async () => {
  let executions = 0;
  const { service, cookie } = createAuthorizedService();
  try {
    const issued = await service.issue({
      target,
      execute: async () => { executions += 1; return { queryId: "q1", affectedRows: 1, verified: true }; },
    });
    const invalid = {
      operator: "operator@example.com",
      confirmation: "RESTORE wrong.table",
    };
    assert.equal((await submit(issued.approvalUrl, invalid, { cookie })).status, 400);
    assert.equal((await submit(issued.approvalUrl, invalid, { cookie })).status, 400);
    assert.equal((await submit(issued.approvalUrl, invalid, { cookie })).status, 429);
    assert.equal((await fetch(issued.approvalUrl, { headers: { cookie } })).status, 410);
    assert.equal(service.getStatus(issued.requestId).status, "failed");
    assert.equal(executions, 0);
  } finally {
    await service.close();
  }
});
