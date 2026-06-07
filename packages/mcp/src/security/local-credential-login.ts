import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export type SqlLoginCredentials = {
  datasource: string;
  username: string;
  password: string;
};

export type SqlLoginRequest = {
  datasource: string;
  bind: (credentials: SqlLoginCredentials) => Promise<void>;
};

export type IssuedSqlLogin = {
  loginUrl: string;
  expiresAt: string;
};

export interface CredentialLoginService {
  issueSqlLogin(request: SqlLoginRequest): Promise<IssuedSqlLogin>;
  close(): Promise<void>;
}

export type LocalCredentialLoginServiceOptions = {
  now?: () => number;
  tokenTtlMs?: number;
};

type PendingSqlLogin = SqlLoginRequest & {
  expiresAtMs: number;
};

function page(title: string, message: string, form = false): string {
  const formHtml = form
    ? `<form method="post">
  <label>Database username <input name="username" autocomplete="username" required></label>
  <label>Database password <input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Connect</button>
</form>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; }
    form { display: grid; gap: 1rem; }
    label { display: grid; gap: .35rem; }
    input, button { font: inherit; padding: .65rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
  ${formHtml}
</body>
</html>`;
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class LocalCredentialLoginService implements CredentialLoginService {
  private readonly now: () => number;
  private readonly tokenTtlMs: number;
  private readonly pending = new Map<string, PendingSqlLogin>();
  private server: Server | undefined;
  private port: number | undefined;

  constructor(options: LocalCredentialLoginServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
  }

  async issueSqlLogin(request: SqlLoginRequest): Promise<IssuedSqlLogin> {
    await this.ensureStarted();
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = this.now() + this.tokenTtlMs;
    this.pending.set(token, { ...request, expiresAtMs });
    return {
      loginUrl: `http://127.0.0.1:${this.port}/sql-login/${token}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async close(): Promise<void> {
    this.pending.clear();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.server) {
      return;
    }
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("Unable to resolve local credential login address.");
    }
    this.server = server;
    this.port = address.port;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/sql-login\/([^/]+)$/);
      const token = match?.[1];
      const pending = token ? this.pending.get(token) : undefined;

      if (!token || !pending || pending.expiresAtMs <= this.now()) {
        if (token) {
          this.pending.delete(token);
        }
        respond(res, 410, page("Invalid login link", "This login link is invalid or has expired."));
        return;
      }

      if (req.method === "GET") {
        respond(res, 200, page("Connect to TaurusDB", "Enter your database credentials.", true));
        return;
      }

      if (req.method !== "POST") {
        respond(res, 405, page("Unsupported request", "Use the login form to continue."));
        return;
      }

      const form = new URLSearchParams(await readBody(req));
      const username = form.get("username")?.trim() ?? "";
      const password = form.get("password") ?? "";
      if (!username || !password) {
        respond(res, 400, page("Connect to TaurusDB", "Username and password are required.", true));
        return;
      }

      this.pending.delete(token);
      try {
        await pending.bind({
          datasource: pending.datasource,
          username,
          password,
        });
      } catch {
        respond(res, 500, page("Connection failed", "Credentials could not be bound to this session."));
        return;
      }
      respond(res, 200, page("Connected", "Database credentials are now active for this MCP session."));
    } catch {
      respond(res, 400, page("Invalid request", "The login request could not be processed."));
    }
  }
}
