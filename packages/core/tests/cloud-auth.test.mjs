import assert from "node:assert/strict";
import test from "node:test";

import { fetchHuaweiCloud } from "../dist/cloud/auth.js";

test("fetchHuaweiCloud signs canonical URI with trailing slash", async () => {
  let capturedHeaders;
  let capturedUrl;

  await fetchHuaweiCloud({
    url: "https://iam.cn-east-3.myhuaweicloud.com/v3/auth/projects",
    headers: {
      "content-type": "application/json",
    },
    auth: {
      accessKeyId: "ak-test",
      secretAccessKey: "sk-test",
    },
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(
    capturedUrl,
    "https://iam.cn-east-3.myhuaweicloud.com/v3/auth/projects",
  );
  const authorization = capturedHeaders.get("authorization");
  assert.ok(authorization);
  assert.match(authorization, /^SDK-HMAC-SHA256 /);
});

test("fetchHuaweiCloud signs requests with credentials from a provider", async () => {
  let capturedHeaders;
  let providerCalls = 0;

  await fetchHuaweiCloud({
    url: "https://csms.cn-east-3.myhuaweicloud.com/v1/project/secrets/name/versions/latest",
    auth: {
      credentialProvider: async () => {
        providerCalls += 1;
        return {
          accessKeyId: "ak-provider",
          secretAccessKey: "sk-provider",
        };
      },
    },
    fetchImpl: async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Response.json({});
    },
  });

  assert.equal(providerCalls, 1);
  assert.match(capturedHeaders.get("authorization"), /Access=ak-provider/);
});

test("fetchHuaweiCloud prefers explicit AK/SK over the credential provider", async () => {
  let providerCalls = 0;
  let capturedHeaders;

  await fetchHuaweiCloud({
    url: "https://csms.cn-east-3.myhuaweicloud.com/v1/project/secrets/name/versions/latest",
    auth: {
      accessKeyId: "ak-explicit",
      secretAccessKey: "sk-explicit",
      credentialProvider: async () => {
        providerCalls += 1;
        return {
          accessKeyId: "ak-provider",
          secretAccessKey: "sk-provider",
        };
      },
    },
    fetchImpl: async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Response.json({});
    },
  });

  assert.equal(providerCalls, 0);
  assert.match(capturedHeaders.get("authorization"), /Access=ak-explicit/);
});

test("fetchHuaweiCloud rejects non-HTTPS and untrusted endpoint hosts", async () => {
  const auth = {
    accessKeyId: "ak-test",
    secretAccessKey: "sk-test",
  };
  await assert.rejects(
    () => fetchHuaweiCloud({
      url: "http://iam.cn-east-3.myhuaweicloud.com/v3/auth/projects",
      auth,
      fetchImpl: async () => Response.json({}),
    }),
    /must use HTTPS/,
  );
  await assert.rejects(
    () => fetchHuaweiCloud({
      url: "https://127.0.0.1/latest/meta-data",
      auth,
      fetchImpl: async () => Response.json({}),
    }),
    /host is not allowed/,
  );
});

test("fetchHuaweiCloud permits an operator-configured private endpoint host", async () => {
  let called = false;
  await fetchHuaweiCloud({
    url: "https://gaussdb.internal.example/v3/projects",
    auth: {
      accessKeyId: "ak-test",
      secretAccessKey: "sk-test",
      allowedEndpointHosts: ["gaussdb.internal.example"],
    },
    fetchImpl: async () => {
      called = true;
      return Response.json({});
    },
  });
  assert.equal(called, true);
});
