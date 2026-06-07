import assert from "node:assert/strict";
import test from "node:test";

import { LocalCredentialLoginService } from "../dist/security/local-credential-login.js";

async function submit(url, fields) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

test("local credential login binds credentials without echoing the password", async () => {
  const bindings = [];
  const service = new LocalCredentialLoginService();

  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });

    assert.match(issued.loginUrl, /^http:\/\/127\.0\.0\.1:\d+\/sql-login\//);
    assert.match(issued.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

    const form = await fetch(issued.loginUrl);
    const formBody = await form.text();
    assert.equal(form.status, 200);
    assert.equal(form.headers.get("cache-control"), "no-store");
    assert.match(formBody, /type="password"/);

    const password = "sensitive-password";
    const response = await submit(issued.loginUrl, {
      username: "db_user",
      password,
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(body, new RegExp(password));
    assert.deepEqual(bindings, [
      {
        datasource: "taurus_mcp",
        username: "db_user",
        password,
      },
    ]);
  } finally {
    await service.close();
  }
});

test("local credential login tokens are single use", async () => {
  const service = new LocalCredentialLoginService();

  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => {},
    });

    assert.equal(
      (await submit(issued.loginUrl, { username: "db_user", password: "pwd" })).status,
      200,
    );
    assert.equal(
      (await submit(issued.loginUrl, { username: "db_user", password: "pwd" })).status,
      410,
    );
  } finally {
    await service.close();
  }
});

test("local credential login rejects expired and unknown tokens", async () => {
  let now = 1_000;
  const service = new LocalCredentialLoginService({
    now: () => now,
    tokenTtlMs: 50,
  });

  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => {},
    });
    now += 51;

    assert.equal((await fetch(issued.loginUrl)).status, 410);
    assert.equal(
      (await fetch(issued.loginUrl.replace(/[^/]+$/, "unknown-token"))).status,
      410,
    );
  } finally {
    await service.close();
  }
});

test("local credential login rejects missing fields without consuming the token", async () => {
  const bindings = [];
  const service = new LocalCredentialLoginService();

  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async (credentials) => bindings.push(credentials),
    });

    const missing = await submit(issued.loginUrl, {
      username: "db_user",
      password: "",
    });
    assert.equal(missing.status, 400);

    const valid = await submit(issued.loginUrl, {
      username: "db_user",
      password: "pwd",
    });
    assert.equal(valid.status, 200);
    assert.equal(bindings.length, 1);
  } finally {
    await service.close();
  }
});

test("local credential login consumes tokens after binding failures", async () => {
  const service = new LocalCredentialLoginService();

  try {
    const issued = await service.issueSqlLogin({
      datasource: "taurus_mcp",
      bind: async () => {
        throw new Error("binding failed with sensitive detail");
      },
    });

    const failed = await submit(issued.loginUrl, {
      username: "db_user",
      password: "pwd",
    });
    const failedBody = await failed.text();
    assert.equal(failed.status, 500);
    assert.doesNotMatch(failedBody, /sensitive detail/);

    assert.equal(
      (await submit(issued.loginUrl, { username: "db_user", password: "pwd" })).status,
      410,
    );
  } finally {
    await service.close();
  }
});
