import mysql from "mysql2/promise";
import type {
  DriverAdapter,
  DriverPool,
  DriverPoolCreateInput,
  DriverSession,
  RawResult,
  ExecOptions,
} from "../connection-pool.js";

type QueryRows = unknown[] | Record<string, unknown>[];

type ManagedConnection = {
  destroyed: boolean;
  released: boolean;
};

function normalizeRows(value: unknown): QueryRows {
  return Array.isArray(value) ? (value as QueryRows) : [];
}

type FieldPacket = { name: string; columnType?: number };

function isStatusPacket(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "affectedRows" in value &&
    "insertId" in value &&
    ("serverStatus" in value || "warningStatus" in value)
  );
}

/**
 * mysql2 returns CALL results as `[resultSet..., statusPacket]` with matching
 * nested field arrays. Exactly one result set is supported; any other shape is
 * rejected rather than guessed at.
 */
function unwrapProcedureResult(
  rows: unknown[],
  fields: unknown,
): { rows: unknown; fields: FieldPacket[] | undefined } {
  const resultSetIndexes = rows.flatMap((entry, index) => (Array.isArray(entry) ? [index] : []));
  const others = rows.filter((entry) => !Array.isArray(entry));
  if (resultSetIndexes.length !== 1 || !others.every(isStatusPacket)) {
    throw new Error(
      `Unrecognized stored procedure result structure: expected one result set and a status packet, got ${resultSetIndexes.length} result set(s) and ${others.length} other item(s).`,
    );
  }
  const index = resultSetIndexes[0];
  const nestedFields = Array.isArray(fields) ? fields[index] : undefined;
  return {
    rows: rows[index],
    fields: Array.isArray(nestedFields) ? (nestedFields as FieldPacket[]) : undefined,
  };
}

function normalizeResult(
  rawRows: unknown,
  rawFields: FieldPacket[] | undefined,
): RawResult {
  const isProcedureResult =
    Array.isArray(rawRows) && rawRows.some((entry) => Array.isArray(entry) || isStatusPacket(entry));
  const { rows, fields } = isProcedureResult
    ? unwrapProcedureResult(rawRows as unknown[], rawFields)
    : { rows: rawRows, fields: rawFields };
  const normalizedRows = normalizeRows(rows);

  if (Array.isArray(rows)) {
    return {
      rows: normalizedRows,
      rowCount: normalizedRows.length,
      fields: fields?.map((field) => ({
        name: field.name,
        type: field.columnType !== undefined ? String(field.columnType) : undefined,
      })),
      raw: rows,
    };
  }

  if (rows && typeof rows === "object") {
    const header = rows as { affectedRows?: number; insertId?: number; warningStatus?: number };
    return {
      rows: [],
      rowCount: header.affectedRows ?? 0,
      affectedRows: header.affectedRows ?? 0,
      raw: rows,
    };
  }

  return {
    rows: [],
    rowCount: 0,
    raw: rows,
  };
}

function toSslOptions(tls: DriverPoolCreateInput["tls"]) {
  if (!tls?.enabled) {
    return undefined;
  }

  return {
    rejectUnauthorized: tls.rejectUnauthorized,
    servername: tls.servername,
    ca: tls.ca,
    cert: tls.cert,
    key: tls.key,
  };
}

class MySqlDriverSession implements DriverSession {
  private readonly connection: Awaited<ReturnType<mysql.Pool["getConnection"]>>;
  private readonly state: ManagedConnection;

  constructor(
    connection: Awaited<ReturnType<mysql.Pool["getConnection"]>>,
    state: ManagedConnection,
  ) {
    this.connection = connection;
    this.state = state;
  }

  async execute(sql: string, options: ExecOptions = {}): Promise<RawResult> {
    const [rows, fields] = await this.connection.query({
      sql,
      timeout: options.timeoutMs,
      rowsAsArray: false,
    });

    return normalizeResult(rows, fields as FieldPacket[] | undefined);
  }

  async cancel(): Promise<void> {
    if (this.state.destroyed) {
      return;
    }
    this.state.destroyed = true;
    this.connection.destroy();
  }

  async release(): Promise<void> {
    if (this.state.released) {
      return;
    }
    this.state.released = true;

    if (this.state.destroyed) {
      return;
    }

    this.connection.release();
  }
}

class MySqlDriverPool implements DriverPool {
  private readonly pool: mysql.Pool;

  constructor(pool: mysql.Pool) {
    this.pool = pool;
  }

  async acquire(): Promise<DriverSession> {
    const connection = await this.pool.getConnection();
    return new MySqlDriverSession(connection, {
      destroyed: false,
      released: false,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createMySqlDriverAdapter(): DriverAdapter {
  return {
    async createPool(input: DriverPoolCreateInput): Promise<DriverPool> {
      const pool = mysql.createPool({
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.username,
        password: input.password,
        dateStrings: true,
        connectionLimit: input.poolSize ?? 4,
        waitForConnections: true,
        queueLimit: 0,
        enableKeepAlive: true,
        multipleStatements: false,
        ssl: toSslOptions(input.tls),
      });

      return new MySqlDriverPool(pool);
    },
  };
}
