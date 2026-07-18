import type { CredentialRef, DataSourceProfile, DatabaseEngine, UserCredential } from "./types.js";
import { asInteger, asString, defaultPortForEngine, parseCredentialRef, parseEngine, withRedactedToString } from "./parsing.js";

export function parseEngineFromDsnProtocol(protocol: string): DatabaseEngine {
  const normalized = protocol.replace(/:$/, "").toLowerCase();
  if (normalized === "mysql" || normalized === "mysql2") {
    return "mysql";
  }
  if (normalized === "postgres" || normalized === "postgresql") {
    return "postgresql";
  }
  throw new Error(`Unsupported DSN protocol: ${protocol}`);
}

export function parseEnvProfile(env: NodeJS.ProcessEnv): DataSourceProfile | undefined {
  const dsn = asString(env.TAURUSDB_SQL_DSN);
  const explicitHost = asString(env.TAURUSDB_SQL_HOST);
  const profileName = asString(env.TAURUSDB_SQL_DATASOURCE) ?? "taurus_mcp";

  let engine: DatabaseEngine;
  let host: string | undefined;
  let port: number;
  let database: string | undefined;
  let username: string | undefined;
  let passwordRef: CredentialRef | undefined;

  if (dsn) {
    const url = new URL(dsn);
    engine = parseEngineFromDsnProtocol(url.protocol);
    host = url.hostname;
    port = url.port ? Number.parseInt(url.port, 10) : defaultPortForEngine(engine);
    database = asString(url.pathname.replace(/^\//, ""));
    username = asString(decodeURIComponent(url.username));
    const dsnPassword = asString(decodeURIComponent(url.password));
    if (dsnPassword) {
      passwordRef = parseCredentialRef(dsnPassword, "TAURUSDB_SQL_DSN.password");
    }
  } else {
    engine = parseEngine(asString(env.TAURUSDB_SQL_ENGINE) ?? "mysql", "TAURUSDB_SQL_ENGINE");
    host = explicitHost;
    const explicitPort = asInteger(env.TAURUSDB_SQL_PORT);
    port = explicitPort ?? defaultPortForEngine(engine);
    database = asString(env.TAURUSDB_SQL_DATABASE);
  }

  if (
    !dsn &&
    !explicitHost &&
    !asString(env.TAURUSDB_SQL_USER) &&
    !asString(env.TAURUSDB_SQL_PASSWORD) &&
    !database
  ) {
    return undefined;
  }

  if (!port || !Number.isFinite(port) || port <= 0) {
    throw new Error("Failed to resolve SQL port from environment.");
  }

  username = username ?? asString(env.TAURUSDB_SQL_USER);
  if (!username) {
    throw new Error("Missing SQL username in environment. Set TAURUSDB_SQL_USER or include it in DSN.");
  }

  passwordRef =
    passwordRef ??
    (Object.hasOwn(env, "TAURUSDB_SQL_PASSWORD")
      ? parseCredentialRef(env.TAURUSDB_SQL_PASSWORD, "TAURUSDB_SQL_PASSWORD")
      : undefined);

  if (!passwordRef) {
    throw new Error("Missing SQL password in environment. Set TAURUSDB_SQL_PASSWORD or include it in DSN.");
  }

  const mutationUsername = asString(env.TAURUSDB_SQL_MUTATION_USER);
  const mutationPasswordRef = Object.hasOwn(env, "TAURUSDB_SQL_MUTATION_PASSWORD")
    ? parseCredentialRef(
        env.TAURUSDB_SQL_MUTATION_PASSWORD,
        "TAURUSDB_SQL_MUTATION_PASSWORD",
      )
    : undefined;
  if ((mutationUsername && !mutationPasswordRef) || (!mutationUsername && mutationPasswordRef)) {
    throw new Error(
      "Mutation credentials require both TAURUSDB_SQL_MUTATION_USER and TAURUSDB_SQL_MUTATION_PASSWORD.",
    );
  }

  const poolSize = asInteger(env.TAURUSDB_SQL_POOL_SIZE);
  if (poolSize !== undefined && poolSize <= 0) {
    throw new Error("Invalid TAURUSDB_SQL_POOL_SIZE: must be positive.");
  }

  return withRedactedToString({
    name: profileName,
    engine,
    host,
    port,
    database,
    user: {
      username,
      password: passwordRef,
    },
    mutationUser:
      mutationUsername && mutationPasswordRef
        ? { username: mutationUsername, password: mutationPasswordRef }
        : undefined,
    poolSize,
  });
}
