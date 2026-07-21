import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import {
  LocalCredentialLoginService,
  SqlCredentialValidationError,
} from "../dist/security/local-credential-login.js";

async function submit(url, fields, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

async function submitWithHost(url, fields, host) {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/x-www-form-urlencoded",
        host,
      },
    }, (res) => {
      res.resume();
      res.once("end", () => resolve(res));
    });
    req.once("error", reject);
    req.end(body);
  });
}

function createService(options = {}) {
  return new LocalCredentialLoginService({ failureDelayMs: 0, ...options });
}

test("local credential login renders a localized neutral target-aware page", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "db-1",
      target: {
        datasource: "db-1",
        instanceId: "instance-123456789",
        region: "cn-north-4",
        credentialIdleTtlMinutes: 30,
        credentialMaxTtlMinutes: 480,
      },
      bind: async () => {},
    });
    const response = await fetch(issued.loginUrl, {
      headers: { "accept-language": "zh-CN,zh;q=0.9" },
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(body, /连接数据库/);
    assert.match(body, /instance-123456789/);
    assert.match(body, /cn-north-4/);
    assert.match(body, /db-1/);
    assert.match(body, /\.target-row \{ grid-column:2; min-width:0;/);
    assert.match(body, /font-family:&quot;SFMono-Regular&quot;|font-family:"SFMono-Regular"/);
    assert.match(body, /凭据对 Agent 不可见/);
    assert.match(body, /空闲 30 分钟后清除 · 最长保留 8 小时/);
    assert.doesNotMatch(body, /安全会话|Secure session/);
    assert.doesNotMatch(body, /Huawei Cloud account login/);
  } finally {
    await service.close();
  }
});

test("local credential login binds credentials without echoing the password", async () => {
  const bindings = [];
  const service = createService();

  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      target: { datasource: "taurus_mcp" },
      bind: async (credentials) => bindings.push(credentials),
    });

    assert.match(issued.loginUrl, /^http:\/\/127\.0\.0\.1:\d+\/sql-login\//);
    assert.match(issued.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

    const password = "sensitive-password";
    const response = await submit(issued.loginUrl, { username: "db_user", password });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(body, new RegExp(password));
    assert.match(body, /Account validated/);
    assert.deepEqual(bindings, [{ datasource: "taurus_mcp", username: "db_user", password }]);
  } finally {
    await service.close();
  }
});

test("successful local credential login tokens are single use", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({ datasource: "taurus_mcp", bind: async () => {} });
    assert.equal((await submit(issued.loginUrl, { username: "db_user", password: "pwd" })).status, 200);
    const replay = await submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    assert.equal(replay.status, 200);
    assert.match(await replay.text(), /Login link expired/i);
  } finally {
    await service.close();
  }
});

test("local credential login rejects expired and unknown tokens", async () => {
  let now = 1_000;
  const service = createService({ now: () => now, tokenTtlMs: 50 });
  try {
    const issued = await service.issueSqlLogin({ datasource: "taurus_mcp", bind: async () => {} });
    now += 51;
    const expired = await fetch(issued.loginUrl);
    assert.equal(expired.status, 200);
    assert.match(await expired.text(), /Login link expired/i);
    const unknown = await fetch(issued.loginUrl.replace(/[^/]+$/, "unknown-token"));
    assert.equal(unknown.status, 200);
    assert.match(await unknown.text(), /Login link expired/i);
  } finally {
    await service.close();
  }
});

test("missing fields do not consume a login attempt", async () => {
  const bindings = [];
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const missing = await submit(issued.loginUrl, { username: "db_user", password: "" });
    assert.equal(missing.status, 200);
    assert.match(await missing.text(), /3 attempts remaining/);

    const valid = await submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    assert.equal(valid.status, 200);
    assert.equal(bindings.length, 1);
  } finally {
    await service.close();
  }
});

test("credential failures allow three attempts and then invalidate the link", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => { throw new SqlCredentialValidationError("credentials"); },
    });
    const first = await submit(issued.loginUrl, { username: "db_user", password: "bad" });
    assert.equal(first.status, 200);
    assert.match(await first.text(), /2 attempts remaining/);
    const second = await submit(issued.loginUrl, { username: "db_user", password: "bad" });
    assert.equal(second.status, 200);
    const third = await submit(issued.loginUrl, { username: "db_user", password: "bad" });
    assert.equal(third.status, 200);
    assert.match(await third.text(), /Attempt limit reached/i);
    assert.equal((await fetch(issued.loginUrl)).status, 200);
  } finally {
    await service.close();
  }
});

test("connectivity failures do not consume credential attempts or leak details", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => { throw new Error("private host 10.0.0.7 refused connection"); },
    });
    const failed = await submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    const body = await failed.text();
    assert.equal(failed.status, 200);
    assert.match(body, /database connection failed/i);
    assert.match(body, /DB_CONNECTION_FAILED/);
    assert.doesNotMatch(body, /10\.0\.0\.7/);
    assert.match(body, /3 attempts remaining/);
  } finally {
    await service.close();
  }
});

test("endpoint and validation failures render actionable messages without HTTP 504", async () => {
  const cases = [
    ["unreachable", "DB_ENDPOINT_UNREACHABLE", /security group.*inbound rules/i],
    ["refused", "DB_CONNECTION_REFUSED", /port refused the connection/i],
    ["timeout", "DB_VALIDATION_TIMEOUT", /validation did not finish in time/i],
    ["tls", "DB_TLS_FAILED", /TLS connection could not be validated/i],
  ];
  for (const [kind, code, message] of cases) {
    const service = createService();
    try {
      const issued = await service.issueSqlLogin({
        datasource: "taurus_mcp",
        bind: async () => { throw new SqlCredentialValidationError(kind); },
      });
      const response = await submit(issued.loginUrl, {
        username: "db_user",
        password: "pwd",
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, new RegExp(code));
      assert.match(body, message);
    } finally {
      await service.close();
    }
  }
});

test("local credential login serializes duplicate submissions", async () => {
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => {
        started();
        await new Promise((resolve) => { release = resolve; });
      },
    });
    const first = submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    await entered;
    const duplicate = await submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    assert.equal(duplicate.status, 200);
    assert.match(await duplicate.text(), /already in progress/i);
    release();
    assert.equal((await first).status, 200);
  } finally {
    await service.close();
  }
});

test("local credential login rejects cross-origin form submissions", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({ datasource: "taurus_mcp", bind: async () => {} });
    const response = await submit(
      issued.loginUrl,
      { username: "db_user", password: "pwd" },
      { origin: "https://attacker.example" },
    );
    assert.equal(response.status, 403);
    assert.equal((await fetch(issued.loginUrl)).status, 200);
  } finally {
    await service.close();
  }
});

test("local credential login accepts sandboxed and loopback-alias browser origins", async () => {
  const bindings = [];
  const service = createService();
  try {
    const sandboxed = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const sandboxedResponse = await submit(
      sandboxed.loginUrl,
      { username: "db_user", password: "pwd" },
      { origin: "null" },
    );
    assert.equal(sandboxedResponse.status, 200);

    const aliased = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const port = new URL(aliased.loginUrl).port;
    const aliasedResponse = await submit(
      aliased.loginUrl,
      { username: "db_user", password: "pwd" },
      { origin: `http://localhost:${port}` },
    );
    assert.equal(aliasedResponse.status, 200);
    assert.equal(bindings.length, 2);
  } finally {
    await service.close();
  }
});

test("local credential login rejects a non-loopback Host header", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({ datasource: "taurus_mcp", bind: async () => {} });
    const response = await submitWithHost(
      issued.loginUrl,
      { username: "db_user", password: "pwd" },
      "attacker.example",
    );
    assert.equal(response.statusCode, 403);
  } finally {
    await service.close();
  }
});

test("target values are escaped before rendering", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "<script>alert(1)</script>",
      target: { datasource: "<script>alert(1)</script>" },
      bind: async () => {},
    });
    const body = await (await fetch(issued.loginUrl)).text();
    assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
    assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  } finally {
    await service.close();
  }
});
