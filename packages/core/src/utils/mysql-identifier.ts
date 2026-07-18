export function quoteMysqlIdentifier(identifier: string, fieldName = "identifier"): string {
  if (identifier.length === 0) {
    throw new Error(`Invalid ${fieldName}: value cannot be empty.`);
  }
  if (identifier.includes("\0")) {
    throw new Error(`Invalid ${fieldName}: NUL bytes are not allowed.`);
  }
  return `\`${identifier.replace(/`/g, "``")}\``;
}
