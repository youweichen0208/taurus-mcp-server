import { monotonicFactory } from "ulid";
const monotonicUlid = monotonicFactory();
function generatePrefixedId(prefix, now = Date.now()) {
    return `${prefix}${monotonicUlid(now).toLowerCase()}`;
}
export function generateTaskId(now) {
    return generatePrefixedId("task_", now);
}
export function generateQueryId(now) {
    return generatePrefixedId("qry_", now);
}
