export function buildServerBoundedReadonlySql(
  sql: string,
  maxRows: number,
): string {
  const normalized = sql.trim().replace(/;\s*$/, "");
  if (!/^(?:select|with)\b/i.test(normalized)) {
    return normalized;
  }
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    throw new Error("maxRows must be a positive integer.");
  }
  return `SELECT * FROM (${normalized}) AS __taurus_mcp_bounded LIMIT ${maxRows + 1}`;
}
