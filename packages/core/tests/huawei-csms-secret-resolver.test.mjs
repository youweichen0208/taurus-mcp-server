import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfigFromEnv,
  createHuaweiCsmsSecretResolver,
} from "../dist/index.js";

function makeConfig() {
  return createConfigFromEnv({
    TAURUSDB_CLOUD_REGION: "cn-north-4",
    TAURUSDB_CLOUD_PROJECT_ID: "project-1",
    TAURUSDB_CLOUD_AUTH_TOKEN: "token-1",
  });
}

test("Huawei CSMS resolver reads the latest secret string", async () => {
  const requests = [];
  const resolver = createHuaweiCsmsSecretResolver({
    config: makeConfig(),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({
        version: { secret_string: "database-password" },
      });
    },
  });

  const value = await resolver("hw-csms:production%2Ftaurusdb");

  assert.equal(value, "database-password");
  assert.equal(
    requests[0].url,
    "https://csms.cn-north-4.myhuaweicloud.com/v1/project-1/secrets/production%2Ftaurusdb/versions/latest",
  );
  assert.equal(new Headers(requests[0].init.headers).get("x-auth-token"), "token-1");
});

test("Huawei CSMS resolver rejects responses without a secret string", async () => {
  const resolver = createHuaweiCsmsSecretResolver({
    config: makeConfig(),
    fetchImpl: async () => Response.json({ version: {} }),
  });

  await assert.rejects(
    resolver("hw-csms:production-taurusdb"),
    /version\.secret_string/,
  );
});

test("Huawei CSMS resolver reports API errors without exposing secret values", async () => {
  const resolver = createHuaweiCsmsSecretResolver({
    config: makeConfig(),
    fetchImpl: async () =>
      Response.json(
        { error_code: "CSMS.0001", error_msg: "secret not found" },
        { status: 404 },
      ),
  });

  await assert.rejects(
    resolver("hw-csms:missing"),
    /Huawei CSMS request failed with status 404 \(CSMS\.0001\): secret not found/,
  );
});
