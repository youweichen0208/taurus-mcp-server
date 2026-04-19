import { monotonicFactory } from "ulid";

const monotonicUlid = monotonicFactory();

function generatePrefixedId(prefix: string, now = Date.now()): string {
  return `${prefix}${monotonicUlid(now).toLowerCase()}`;
}

export function generateTaskId(now?: number): string {
  return generatePrefixedId("task_", now);
}

export function generateQueryId(now?: number): string {
  return generatePrefixedId("qry_", now);
}
