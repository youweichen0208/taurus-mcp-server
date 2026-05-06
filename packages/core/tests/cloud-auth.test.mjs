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
