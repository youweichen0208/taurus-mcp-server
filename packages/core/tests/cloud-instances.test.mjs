import assert from "node:assert/strict";
import test from "node:test";

import { CloudTaurusInstanceClient } from "../dist/cloud/instances.js";

test("cloud instance client resolves a unique instance by host and port", async () => {
  const client = new CloudTaurusInstanceClient({
    endpoint: "https://gaussdb.cn-north-4.myhuaweicloud.com",
    auth: {
      projectId: "project-1",
      authToken: "token-1",
    },
    language: "zh-cn",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          instances: [
            {
              id: "instance-1",
              name: "prod-a",
              private_ips: ["10.0.0.8"],
              proxy_ips: ["10.0.0.9"],
              port: "3306",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  const instance = await client.resolveByHostPort("10.0.0.9", 3306);

  assert.equal(instance.id, "instance-1");
  assert.equal(instance.name, "prod-a");
});

test("cloud instance client rejects ambiguous host and port matches", async () => {
  const client = new CloudTaurusInstanceClient({
    endpoint: "https://gaussdb.cn-north-4.myhuaweicloud.com",
    auth: {
      projectId: "project-1",
      authToken: "token-1",
    },
    language: "zh-cn",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          instances: [
            {
              id: "instance-1",
              name: "prod-a",
              private_ips: ["10.0.0.8"],
              port: "3306",
            },
            {
              id: "instance-2",
              name: "prod-b",
              private_ips: ["10.0.0.8"],
              port: "3306",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await assert.rejects(
    () => client.resolveByHostPort("10.0.0.8", 3306),
    /Multiple cloud instances matched/,
  );
});
