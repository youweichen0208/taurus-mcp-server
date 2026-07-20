import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { BrowserOperatorSessionStore } from "./browser-operator-session.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PENDING = 100;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

export type RecoveryTarget = {
  datasource: string;
  recycleTable: string;
  destinationDatabase: string;
  destinationTable: string;
};

export type RecoveryExecutionResult = {
  queryId: string;
  affectedRows: number;
  verified: boolean;
};

export type RecoveryRequestStatus = {
  requestId: string;
  status: "pending" | "executing" | "succeeded" | "failed" | "expired";
  target: RecoveryTarget;
  createdAt: string;
  expiresAt: string;
  operator?: string;
  completedAt?: string;
  result?: RecoveryExecutionResult;
  error?: string;
};

export type RecoveryApprovalRequest = {
  target: RecoveryTarget;
  execute: (operator: string, requestId: string) => Promise<RecoveryExecutionResult>;
};

export type IssuedRecoveryApproval = {
  requestId: string;
  approvalUrl: string;
  expiresAt: string;
};

export interface RecoveryApprovalService {
  issue(request: RecoveryApprovalRequest): Promise<IssuedRecoveryApproval>;
  getStatus(requestId: string): RecoveryRequestStatus | undefined;
  close(): Promise<void>;
}

export type LocalRecoveryApprovalServiceOptions = {
  operatorSessions: BrowserOperatorSessionStore;
  now?: () => number;
  ttlMs?: number;
  maxPending?: number;
  maxAttempts?: number;
};

type PendingRecovery = {
  token: string;
  request: RecoveryApprovalRequest;
  status: RecoveryRequestStatus;
  failedAttempts: number;
};

type Locale = "zh-CN" | "en";

function localeFromRequest(req: IncomingMessage): Locale {
  return /(?:^|,)\s*zh(?:-|_|;|,|$)/i.test(req.headers["accept-language"] ?? "")
    ? "zh-CN"
    : "en";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function confirmationText(target: RecoveryTarget): string {
  return `RESTORE ${target.destinationDatabase}.${target.destinationTable}`;
}

function page(input: {
  locale: Locale;
  state: "confirm" | "success" | "failed" | "expired" | "invalid";
  target?: RecoveryTarget;
  message?: string;
}): string {
  const zh = input.locale === "zh-CN";
  const target = input.target;
  const title = input.state === "confirm"
    ? (zh ? "确认回收站恢复" : "Confirm recycle-bin recovery")
    : input.state === "success"
      ? (zh ? "恢复已完成" : "Recovery completed")
      : input.state === "failed"
        ? (zh ? "恢复失败" : "Recovery failed")
        : input.state === "expired"
          ? (zh ? "恢复申请已失效" : "Recovery request expired")
          : (zh ? "无法处理申请" : "Request could not be processed");
  const message = input.message ?? (input.state === "confirm"
    ? (zh
        ? "请核对目标并输入操作人身份和确认短语。确认后将立即执行，无法由 Agent 撤销。"
        : "Review the target, then enter the operator identity and confirmation phrase. Approval executes immediately and cannot be revoked by the Agent.")
    : input.state === "success"
      ? (zh ? "目标表已经恢复并通过只读验证，可以返回 MCP 会话。" : "The table was restored and verified. Return to the MCP session.")
      : input.state === "expired"
        ? (zh ? "请返回 MCP 会话重新创建恢复申请。" : "Return to the MCP session and create a new recovery request.")
        : (zh ? "请返回 MCP 会话查看恢复状态。" : "Return to the MCP session to inspect recovery status."));
  const phrase = target ? confirmationText(target) : "";
  const body = input.state === "confirm" && target
    ? `<form method="post" autocomplete="off">
        <label>${zh ? "操作人身份" : "Operator identity"}</label>
        <input name="operator" maxlength="256" required placeholder="name@example.com">
        <label>${zh ? "确认短语" : "Confirmation phrase"}</label>
        <code>${escapeHtml(phrase)}</code>
        <input name="confirmation" maxlength="512" required autocomplete="off">
        <button type="submit">${zh ? "确认并立即恢复" : "Approve and restore now"}</button>
      </form>`
    : `<section class="result"><span>${input.state === "success" ? "✓" : "!"}</span><p>${escapeHtml(message)}</p></section>`;
  return `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · TaurusDB MCP</title><style>
    :root{color-scheme:light;--ink:#172033;--muted:#647184;--bg:#f3f6fa;--line:#dce3eb;--danger:#b42318;--teal:#087f73}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.panel{width:min(720px,calc(100% - 32px));background:#fff;border:1px solid var(--line);border-radius:22px;padding:40px;box-shadow:0 22px 60px rgba(23,32,51,.12)}.brand{font-weight:760;color:var(--teal)}h1{font-size:32px;margin:18px 0 10px}p{color:var(--muted);line-height:1.65}.warning{padding:14px 16px;border-radius:12px;background:#fff0ee;color:var(--danger);font-weight:650}.grid{display:grid;grid-template-columns:160px 1fr;gap:10px;margin:24px 0;padding:18px;background:#f8fafc;border-radius:14px}.grid b{color:var(--muted)}label{display:block;margin:18px 0 7px;font-weight:700}input{width:100%;padding:13px;border:1px solid #bdc8d5;border-radius:10px;font:inherit}code{display:block;padding:12px;border-radius:9px;background:#eef3f7;font-weight:700}button{width:100%;margin-top:24px;padding:14px;border:0;border-radius:10px;background:var(--danger);color:#fff;font:inherit;font-weight:760;cursor:pointer}.result span{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#e7f5f2;color:var(--teal);font-size:24px;font-weight:800}@media(max-width:600px){.panel{padding:26px}.grid{grid-template-columns:1fr}h1{font-size:27px}}</style></head><body><main class="panel"><div class="brand">TaurusDB MCP · Controlled Recovery</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${target ? `<div class="warning">${zh ? "此操作会改变数据库状态，是只读 Harness 的唯一受控例外。" : "This changes database state and is the only controlled exception to the read-only Harness."}</div><div class="grid"><b>Datasource</b><span>${escapeHtml(target.datasource)}</span><b>${zh ? "回收站对象" : "Recycle object"}</b><span>${escapeHtml(target.recycleTable)}</span><b>${zh ? "恢复目标" : "Destination"}</b><span>${escapeHtml(`${target.destinationDatabase}.${target.destinationTable}`)}</span></div>` : ""}${body}</main></body></html>`;
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class LocalRecoveryApprovalService implements RecoveryApprovalService {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly maxAttempts: number;
  private readonly operatorSessions: BrowserOperatorSessionStore;
  private readonly byToken = new Map<string, PendingRecovery>();
  private readonly byRequestId = new Map<string, RecoveryRequestStatus>();
  private server?: Server;
  private port?: number;

  constructor(options: LocalRecoveryApprovalServiceOptions) {
    this.operatorSessions = options.operatorSessions;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async issue(request: RecoveryApprovalRequest): Promise<IssuedRecoveryApproval> {
    this.expirePending();
    if (this.byToken.size >= this.maxPending) throw new Error("Too many pending recovery requests.");
    await this.ensureStarted();
    const token = randomBytes(32).toString("base64url");
    const requestId = `rrq_${randomBytes(16).toString("base64url")}`;
    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + this.ttlMs;
    const status: RecoveryRequestStatus = {
      requestId,
      status: "pending",
      target: { ...request.target },
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    const pending = { token, request, status, failedAttempts: 0 };
    this.byToken.set(token, pending);
    this.byRequestId.set(requestId, status);
    return {
      requestId,
      approvalUrl: `http://127.0.0.1:${this.port}/recovery/${token}`,
      expiresAt: status.expiresAt,
    };
  }

  getStatus(requestId: string): RecoveryRequestStatus | undefined {
    this.expirePending();
    const status = this.byRequestId.get(requestId);
    return status ? structuredClone(status) : undefined;
  }

  async close(): Promise<void> {
    this.byToken.clear();
    this.byRequestId.clear();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private expirePending(): void {
    const now = this.now();
    for (const [token, pending] of this.byToken) {
      if (Date.parse(pending.status.expiresAt) <= now) {
        pending.status.status = "expired";
        pending.status.completedAt = new Date(now).toISOString();
        this.byToken.delete(token);
      }
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("Unable to resolve local recovery approval address.");
    }
    this.server = server;
    this.port = address.port;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const locale = localeFromRequest(req);
    try {
      this.expirePending();
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = url.pathname.match(/^\/recovery\/([^/]+)$/)?.[1];
      const pending = token ? this.byToken.get(token) : undefined;
      if (!token || !pending) {
        respond(res, 410, page({ locale, state: "expired" }));
        return;
      }
      const cookieHeader = Array.isArray(req.headers.cookie)
        ? req.headers.cookie.join("; ")
        : req.headers.cookie;
      const browserAuthorized = this.operatorSessions.authorizes(
        cookieHeader,
        pending.request.target.datasource,
      );
      if (req.method === "GET") {
        respond(res, browserAuthorized ? 200 : 401, browserAuthorized
          ? page({ locale, state: "confirm", target: pending.request.target })
          : page({
              locale,
              state: "invalid",
              target: pending.request.target,
              message: locale === "zh-CN"
                ? "请先在同一浏览器中完成该数据源的数据库登录，再确认恢复。"
                : "Complete database login for this datasource in the same browser before approving recovery.",
            }));
        return;
      }
      if (req.method !== "POST") {
        respond(res, 405, page({ locale, state: "invalid", target: pending.request.target }));
        return;
      }
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) {
        respond(res, 403, page({ locale, state: "invalid", target: pending.request.target }));
        return;
      }
      if (!browserAuthorized) {
        respond(res, 401, page({
          locale,
          state: "invalid",
          target: pending.request.target,
          message: locale === "zh-CN"
            ? "请先在同一浏览器中完成该数据源的数据库登录，再确认恢复。"
            : "Complete database login for this datasource in the same browser before approving recovery.",
        }));
        return;
      }
      const form = new URLSearchParams(await readBody(req));
      const operator = form.get("operator")?.trim() ?? "";
      const confirmation = form.get("confirmation") ?? "";
      if (!operator || confirmation !== confirmationText(pending.request.target)) {
        pending.failedAttempts += 1;
        if (pending.failedAttempts >= this.maxAttempts) {
          this.byToken.delete(token);
          pending.status.status = "failed";
          pending.status.error = "Recovery approval attempt limit reached. Create a new request.";
          pending.status.completedAt = new Date(this.now()).toISOString();
          respond(res, 429, page({ locale, state: "failed", target: pending.request.target }));
          return;
        }
        respond(res, 400, page({
          locale,
          state: "confirm",
          target: pending.request.target,
          message: locale === "zh-CN" ? "操作人身份或确认短语不正确，未执行恢复。" : "Operator identity or confirmation phrase is invalid. Recovery was not executed.",
        }));
        return;
      }

      this.byToken.delete(token);
      pending.status.status = "executing";
      pending.status.operator = operator;
      try {
        const result = await pending.request.execute(operator, pending.status.requestId);
        pending.status.status = "succeeded";
        pending.status.result = result;
        pending.status.completedAt = new Date(this.now()).toISOString();
        respond(res, 200, page({ locale, state: "success", target: pending.request.target }));
      } catch (error) {
        pending.status.status = "failed";
        void error;
        pending.status.error = "Recovery failed. Inspect the MCP audit log and database state before retrying.";
        pending.status.completedAt = new Date(this.now()).toISOString();
        respond(res, 500, page({ locale, state: "failed", target: pending.request.target }));
      }
    } catch {
      respond(res, 400, page({ locale, state: "invalid" }));
    }
  }
}
