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

function normalizeResult(
  rows: unknown,
  fields: Array<{ name: string; columnType?: number }> | undefined,
): RawResult {
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

    return normalizeResult(rows, fields as Array<{ name: string; columnType?: number }> | undefined);
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
