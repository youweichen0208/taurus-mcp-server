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

// Most tests assert English copy, so they use links that select English.
// The default (Chinese) page is covered by createDefaultLocaleService below.
function createService(options = {}) {
  const service = new LocalCredentialLoginService({ failureDelayMs: 0, ...options });
  const issue = service.issueSqlLogin.bind(service);
  service.issueSqlLogin = async (request) => {
    const issued = await issue(request);
    return { ...issued, loginUrl: `${issued.loginUrl}?lang=en` };
  };
  return service;
}

function createDefaultLocaleService(options = {}) {
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
    const response = await fetch(issued.loginUrl.replace("?lang=en", ""));
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(body, /连接数据库/);
    assert.match(body, /instance-123456789/);
    assert.match(body, /cn-north-4/);
    assert.match(body, /db-1/);
    assert.match(body, /目标实例 <code>instance-123456789<\/code>/);
    assert.match(body, /<ol class="path-nodes" aria-label="凭据的传递路径">/);
    assert.match(body, /本机 MCP<code>127\.0\.0\.1<\/code>/);
    assert.match(body, /AI 助手看不到它，MCP 也不会把它保存到磁盘/);
    assert.match(body, /空闲 30 分钟后自动清除登录，最长保留 8 小时。/);
    // The page must stay neutral: no Huawei brand red or branding.
    assert.doesNotMatch(body, /#c7000b/i);
    assert.doesNotMatch(body, /华为|Huawei/i);
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
    const unknown = await fetch(new URL("unknown-token?lang=en", issued.loginUrl));
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

function startSlowSubmit(url, fields) {
  const body = new URLSearchParams(fields).toString();
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/x-www-form-urlencoded",
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.once("end", () => resolve({ status: res.statusCode, text }));
    });
    req.once("error", reject);
    req.write(body.slice(0, 5));
    finish = () => req.end(body.slice(5));
  });
  return { response, finish: () => finish() };
}

async function waitFor(predicate) {
  for (let i = 0; i < 100 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a login link is claimed before its request body is read", async () => {
  const bindings = [];
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const slow = startSlowSubmit(issued.loginUrl, { username: "first", password: "pwd" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const duplicate = await submit(issued.loginUrl, { username: "second", password: "pwd" });
    assert.match(await duplicate.text(), /already in progress/i);
    slow.finish();
    const first = await slow.response;
    assert.match(first.text, /Account validated/);
    assert.deepEqual(bindings.map((binding) => binding.username), ["first"]);
    const replay = await submit(issued.loginUrl, { username: "third", password: "pwd" });
    assert.match(await replay.text(), /Login link expired/i);
    assert.equal(bindings.length, 1);
  } finally {
    await service.close();
  }
});

test("a login link revoked while its body is uploading never binds credentials", async () => {
  const bindings = [];
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const slow = startSlowSubmit(issued.loginUrl, { username: "db_user", password: "pwd" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.revoke("taurus_mcp");
    slow.finish();
    const result = await slow.response;
    assert.match(result.text, /Login link expired/i);
    assert.match(result.text, /connection target changed/i);
    assert.equal(bindings.length, 0);
  } finally {
    await service.close();
  }
});

test("a login link that expires while its body is uploading never binds credentials", async () => {
  let now = 1_000;
  const bindings = [];
  const service = createService({ now: () => now, tokenTtlMs: 1_000 });
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const slow = startSlowSubmit(issued.loginUrl, { username: "db_user", password: "pwd" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    now += 5_000;
    slow.finish();
    assert.match((await slow.response).text, /Login link expired/i);
    assert.equal(bindings.length, 0);
  } finally {
    await service.close();
  }
});

test("revoking one datasource leaves other login links usable", async () => {
  const service = createService();
  try {
    const a = await service.issueSqlLogin({ datasource: "a", bind: async () => {} });
    const b = await service.issueSqlLogin({ datasource: "b", bind: async () => {} });
    service.revoke("a");
    assert.match(await (await fetch(a.loginUrl)).text(), /Login link expired/i);
    assert.match(await (await fetch(b.loginUrl)).text(), /Connect to database/);
  } finally {
    await service.close();
  }
});

test("a stale bind result invalidates the link and explains why", async () => {
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => { throw new SqlCredentialValidationError("stale"); },
    });
    const response = await submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    assert.match(await response.text(), /connection target changed/i);
    assert.match(await (await fetch(issued.loginUrl)).text(), /Login link expired/i);
  } finally {
    await service.close();
  }
});

test("bind receives a liveness check that reflects revocation", async () => {
  let link;
  let release;
  const service = createService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (_credentials, context) => {
        link = context;
        await new Promise((resolve) => { release = resolve; });
        if (!context.isActive()) throw new SqlCredentialValidationError("stale");
      },
    });
    const pending = submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    await waitFor(() => link !== undefined);
    assert.equal(link.isActive(), true);
    service.revoke();
    assert.equal(link.isActive(), false);
    release();
    assert.match(await (await pending).text(), /connection target changed/i);
  } finally {
    await service.close();
  }
});

test("connection failures are rate limited while the link stays claimed", async () => {
  let calls = 0;
  const service = createService({ failureDelayMs: 150 });
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => {
        calls += 1;
        throw new SqlCredentialValidationError("unreachable");
      },
    });
    const startedAt = Date.now();
    const first = submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    await waitFor(() => calls === 1);
    const duringBackoff = await submit(issued.loginUrl, { username: "db_user", password: "pwd" });
    assert.match(await duringBackoff.text(), /already in progress/i);
    assert.match(await (await first).text(), /DB_ENDPOINT_UNREACHABLE/);
    assert.ok(Date.now() - startedAt >= 140);
    assert.equal(calls, 1);
  } finally {
    await service.close();
  }
});


test("login page defaults to Chinese, even for an English browser", async () => {
  const service = createDefaultLocaleService();
  try {
    const issued = await service.issueSqlLogin({ datasource: "taurus_mcp", bind: async () => {} });
    const body = await (await fetch(issued.loginUrl, {
      headers: { "accept-language": "en-US,en;q=0.9" },
    })).text();
    assert.match(body, /<html lang="zh-CN">/);
    assert.match(body, /连接数据库/);
    assert.doesNotMatch(body, /Connect to database/);
  } finally {
    await service.close();
  }
});

test("login page offers a Chinese / English switch that keeps the link usable", async () => {
  const bindings = [];
  const service = createDefaultLocaleService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });
    const chinese = await (await fetch(issued.loginUrl)).text();
    assert.match(chinese, /href="\?lang=en"[^>]*>English</);
    assert.match(chinese, /aria-current="true"[^>]*>中文</);

    const english = await (await fetch(`${issued.loginUrl}?lang=en`)).text();
    assert.match(english, /<html lang="en">/);
    assert.match(english, /Connect to database/);
    assert.match(english, /href="\?lang=zh-CN"[^>]*>中文</);
    assert.match(english, /<form method="post" action="\?lang=en"/);

    // Switching language is a GET and must not consume the link.
    const result = await submit(`${issued.loginUrl}?lang=en`, { username: "db_user", password: "pwd" });
    assert.match(await result.text(), /Account validated/);
    assert.equal(bindings.length, 1);
  } finally {
    await service.close();
  }
});

test("validation errors stay in the selected language", async () => {
  const service = createDefaultLocaleService();
  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => { throw new SqlCredentialValidationError("credentials"); },
    });
    const zh = await submit(issued.loginUrl, { username: "db_user", password: "bad" });
    assert.match(await zh.text(), /无法验证账号信息/);
    const en = await submit(`${issued.loginUrl}?lang=en`, { username: "db_user", password: "bad" });
    assert.match(await en.text(), /could not be validated/);
  } finally {
    await service.close();
  }
});

test("an unknown lang value falls back to Chinese", async () => {
  const service = createDefaultLocaleService();
  try {
    const issued = await service.issueSqlLogin({ datasource: "taurus_mcp", bind: async () => {} });
    const body = await (await fetch(`${issued.loginUrl}?lang=%22%3E%3Cscript%3E`)).text();
    assert.match(body, /<html lang="zh-CN">/);
    assert.doesNotMatch(body, /<script>/);
  } finally {
    await service.close();
  }
});
