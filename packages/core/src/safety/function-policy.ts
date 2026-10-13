/**
 * Built-in MySQL/TaurusDB functions that cannot change persistent state, take
 * locks, sleep, read server files, or call back into user code. Anything not
 * listed here — including every user-defined or schema-qualified function — is
 * rejected, because a stored function can execute arbitrary writes even inside
 * a SELECT, a derived COUNT, or the optimizer phase of EXPLAIN.
 */
const SAFE_BUILTIN_FUNCTIONS = new Set([
  // Aggregates
  "AVG", "BIT_AND", "BIT_OR", "BIT_XOR", "COUNT", "GROUP_CONCAT", "JSON_ARRAYAGG",
  "JSON_OBJECTAGG", "MAX", "MIN", "STD", "STDDEV", "STDDEV_POP", "STDDEV_SAMP", "SUM",
  "VAR_POP", "VAR_SAMP", "VARIANCE",
  // Window functions
  "CUME_DIST", "DENSE_RANK", "FIRST_VALUE", "LAG", "LAST_VALUE", "LEAD", "NTH_VALUE",
  "NTILE", "PERCENT_RANK", "RANK", "ROW_NUMBER",
  // Control flow and comparison
  "COALESCE", "GREATEST", "IF", "IFNULL", "INTERVAL", "ISNULL", "LEAST", "NULLIF",
  "CAST", "CONVERT",
  // Strings
  "ASCII", "BIN", "BIT_LENGTH", "CHAR", "CHAR_LENGTH", "CHARACTER_LENGTH", "CONCAT",
  "CONCAT_WS", "ELT", "EXPORT_SET", "FIELD", "FIND_IN_SET", "FORMAT", "FROM_BASE64",
  "HEX", "INSERT", "INSTR", "LCASE", "LEFT", "LENGTH", "LOCATE", "LOWER", "LPAD",
  "LTRIM", "MAKE_SET", "MID", "OCT", "OCTET_LENGTH", "ORD", "POSITION", "QUOTE",
  "REGEXP_INSTR", "REGEXP_LIKE", "REGEXP_REPLACE", "REGEXP_SUBSTR", "REPEAT", "REPLACE",
  "REVERSE", "RIGHT", "RPAD", "RTRIM", "SOUNDEX", "SPACE", "STRCMP", "SUBSTR",
  "SUBSTRING", "SUBSTRING_INDEX", "TO_BASE64", "TRIM", "UCASE", "UNHEX", "UPPER",
  "WEIGHT_STRING", "COLLATION", "CHARSET", "COERCIBILITY",
  // Numbers
  "ABS", "ACOS", "ASIN", "ATAN", "ATAN2", "CEIL", "CEILING", "CONV", "COS", "COT",
  "CRC32", "DEGREES", "EXP", "FLOOR", "LN", "LOG", "LOG10", "LOG2", "MOD", "PI",
  "POW", "POWER", "RADIANS", "RAND", "ROUND", "SIGN", "SIN", "SQRT", "TAN", "TRUNCATE",
  // Dates and times
  "ADDDATE", "ADDTIME", "CONVERT_TZ", "CURDATE", "CURRENT_DATE", "CURRENT_TIME",
  "CURRENT_TIMESTAMP", "CURTIME", "DATE", "DATE_ADD", "DATE_FORMAT", "DATE_SUB",
  "DATEDIFF", "DAY", "DAYNAME", "DAYOFMONTH", "DAYOFWEEK", "DAYOFYEAR", "EXTRACT",
  "FROM_DAYS", "FROM_UNIXTIME", "GET_FORMAT", "HOUR", "LAST_DAY", "LOCALTIME",
  "LOCALTIMESTAMP", "MAKEDATE", "MAKETIME", "MICROSECOND", "MINUTE", "MONTH",
  "MONTHNAME", "NOW", "PERIOD_ADD", "PERIOD_DIFF", "QUARTER", "SEC_TO_TIME", "SECOND",
  "STR_TO_DATE", "SUBDATE", "SUBTIME", "SYSDATE", "TIME", "TIME_FORMAT", "TIME_TO_SEC",
  "TIMEDIFF", "TIMESTAMP", "TIMESTAMPADD", "TIMESTAMPDIFF", "TO_DAYS", "TO_SECONDS",
  "UNIX_TIMESTAMP", "UTC_DATE", "UTC_TIME", "UTC_TIMESTAMP", "WEEK", "WEEKDAY",
  "WEEKOFYEAR", "YEAR", "YEARWEEK",
  // JSON
  "JSON_ARRAY", "JSON_CONTAINS", "JSON_CONTAINS_PATH", "JSON_DEPTH", "JSON_EXTRACT",
  "JSON_KEYS", "JSON_LENGTH", "JSON_OBJECT", "JSON_OVERLAPS", "JSON_PRETTY", "JSON_QUOTE",
  "JSON_SEARCH", "JSON_TYPE", "JSON_UNQUOTE", "JSON_VALID", "JSON_VALUE",
  // Hashing and encoding
  "MD5", "SHA", "SHA1", "SHA2", "INET_ATON", "INET_NTOA", "INET6_ATON", "INET6_NTOA",
  "IS_IPV4", "IS_IPV6", "UUID", "UUID_TO_BIN", "BIN_TO_UUID",
  // Session information
  "CONNECTION_ID", "CURRENT_ROLE", "CURRENT_USER", "DATABASE", "FOUND_ROWS",
  "ROW_COUNT", "SCHEMA", "SESSION_USER", "SYSTEM_USER", "USER", "VERSION",
]);

export type FunctionPolicyViolation = {
  function: string;
  reason: "qualified" | "not_allowed" | "unresolved";
};

export function findUnsafeFunctions(
  functions: Array<{ name: string; schema?: string }>,
): FunctionPolicyViolation[] {
  const violations: FunctionPolicyViolation[] = [];
  for (const fn of functions) {
    const name = fn.name.trim();
    if (!name) {
      violations.push({ function: "<unresolved>", reason: "unresolved" });
    } else if (fn.schema) {
      violations.push({ function: `${fn.schema}.${name}`, reason: "qualified" });
    } else if (!SAFE_BUILTIN_FUNCTIONS.has(name.toUpperCase())) {
      violations.push({ function: name, reason: "not_allowed" });
    }
  }
  return violations;
}
