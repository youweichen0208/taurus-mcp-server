import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_FAILURE_DELAY_MS = 1_000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export type SqlLoginCredentials = {
  datasource: string;
  username: string;
  password: string;
};

export type SqlLoginTarget = {
  datasource: string;
  instanceId?: string;
  region?: string;
  credentialIdleTtlMinutes?: number;
  credentialMaxTtlMinutes?: number;
};

export type SqlLoginRequest = {
  datasource: string;
  target?: SqlLoginTarget;
  bind: (credentials: SqlLoginCredentials) => Promise<void>;
};

export type IssuedSqlLogin = {
  loginUrl: string;
  expiresAt: string;
};

export type CredentialValidationFailure =
  | "credentials"
  | "connectivity"
  | "tls"
  | "timeout";

export class SqlCredentialValidationError extends Error {
  readonly kind: CredentialValidationFailure;

  constructor(kind: CredentialValidationFailure) {
    super(`SQL credential validation failed: ${kind}`);
    this.name = "SqlCredentialValidationError";
    this.kind = kind;
  }
}

export interface CredentialLoginService {
  issueSqlLogin(request: SqlLoginRequest): Promise<IssuedSqlLogin>;
  close(): Promise<void>;
}

export type LocalCredentialLoginServiceOptions = {
  now?: () => number;
  tokenTtlMs?: number;
  maxAttempts?: number;
  failureDelayMs?: number;
};

type PendingSqlLogin = SqlLoginRequest & {
  expiresAtMs: number;
  failedAttempts: number;
  inFlight: boolean;
};

type Locale = "zh-CN" | "en";
type PageState = "form" | "success" | "expired" | "locked" | "method" | "invalid";

const COPY = {
  "zh-CN": {
    product: "TaurusDB MCP",
    secureSession: "安全会话",
    title: "连接数据库",
    intro: "输入数据库账号和密码以验证连接。",
    target: "连接目标",
    instance: "实例",
    region: "区域",
    datasource: "数据源",
    configured: "已配置的数据源",
    unknown: "未指定",
    username: "数据库账号",
    password: "数据库密码",
    usernamePlaceholder: "请输入数据库账号",
    passwordPlaceholder: "请输入数据库密码",
    submit: "连接数据库",
    submitting: "正在验证连接…",
    privacy: "凭据对 Agent 不可见，仅用于连接您选择的数据库，不会由 MCP 持久化保存。",
    retention: (idle: number, maximum: number) => `空闲 ${idle} 分钟后清除 · 最长保留 ${maximum >= 60 ? `${maximum / 60} 小时` : `${maximum} 分钟`}`,
    attempts: (remaining: number) => `本链接还可尝试 ${remaining} 次`,
    required: "请输入数据库账号和密码。",
    credentials: "无法验证账号信息，请检查账号和密码。",
    connectivity: "数据库服务暂时不可达，请检查网络和实例状态。",
    tls: "TLS 安全连接验证失败，请联系管理员检查证书配置。",
    timeout: "连接验证超时，请稍后重试。",
    busy: "连接正在验证，请勿重复提交。",
    successTitle: "账号验证成功",
    successMessage: "您现在可以返回 MCP 会话并选择需要访问的数据库。",
    expiredTitle: "登录链接已失效",
    expiredMessage: "请返回 MCP 会话并重新调用 begin_sql_login。",
    lockedTitle: "尝试次数已用完",
    lockedMessage: "为保护数据库账号，此链接已失效。请返回 MCP 会话重新生成登录链接。",
    methodTitle: "不支持此请求",
    methodMessage: "请使用登录表单继续。",
    invalidTitle: "无法处理请求",
    invalidMessage: "登录请求无效，请重新生成登录链接。",
  },
  en: {
    product: "TaurusDB MCP",
    secureSession: "Secure session",
    title: "Connect to database",
    intro: "Enter your database credentials to validate the connection.",
    target: "Connection target",
    instance: "Instance",
    region: "Region",
    datasource: "Datasource",
    configured: "Configured datasource",
    unknown: "Not specified",
    username: "Database username",
    password: "Database password",
    usernamePlaceholder: "Enter database username",
    passwordPlaceholder: "Enter database password",
    submit: "Connect to database",
    submitting: "Validating connection…",
    privacy: "Credentials are not visible to the Agent. They are used only to connect to your selected database and are not persisted by MCP.",
    retention: (idle: number, maximum: number) => `Cleared after ${idle} idle minutes · ${maximum >= 60 ? `${maximum / 60} ${maximum === 60 ? "hour" : "hours"}` : `${maximum} ${maximum === 1 ? "minute" : "minutes"}`} maximum`,
    attempts: (remaining: number) => `${remaining} attempts remaining for this link`,
    required: "Enter both the database username and password.",
    credentials: "The account could not be validated. Check the username and password.",
    connectivity: "The database is currently unreachable. Check the network and instance status.",
    tls: "The TLS connection could not be validated. Ask an administrator to check the certificate configuration.",
    timeout: "Connection validation timed out. Try again shortly.",
    busy: "Connection validation is already in progress. Do not submit again.",
    successTitle: "Account validated",
    successMessage: "Return to your MCP session and select the database you want to access.",
    expiredTitle: "Login link expired",
    expiredMessage: "Return to your MCP session and call begin_sql_login again.",
    lockedTitle: "Attempt limit reached",
    lockedMessage: "This link has expired to protect the database account. Return to your MCP session and create a new login link.",
    methodTitle: "Unsupported request",
    methodMessage: "Use the login form to continue.",
    invalidTitle: "Request could not be processed",
    invalidMessage: "The login request is invalid. Create a new login link.",
  },
} as const;

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

function maskInstanceId(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  if (value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function page(input: {
  locale: Locale;
  state: PageState;
  target?: SqlLoginTarget;
  message?: string;
  username?: string;
  remainingAttempts?: number;
}): string {
  const copy = COPY[input.locale];
  const isForm = input.state === "form";
  const title = isForm
    ? copy.title
    : input.state === "success"
      ? copy.successTitle
      : input.state === "expired"
        ? copy.expiredTitle
        : input.state === "locked"
          ? copy.lockedTitle
          : input.state === "method"
            ? copy.methodTitle
            : copy.invalidTitle;
  const message = input.message ?? (isForm
    ? copy.intro
    : input.state === "success"
      ? copy.successMessage
      : input.state === "expired"
        ? copy.expiredMessage
        : input.state === "locked"
          ? copy.lockedMessage
          : input.state === "method"
            ? copy.methodMessage
            : copy.invalidMessage);
  const nonce = randomBytes(18).toString("base64url");
  const target = input.target;
  const formHtml = isForm
    ? `<form method="post" autocomplete="on" data-login-form>
        ${input.message ? `<div class="alert" role="alert">${escapeHtml(input.message)}</div>` : ""}
        <label for="username">${copy.username}</label>
        <input id="username" name="username" autocomplete="username" maxlength="256" value="${escapeHtml(input.username ?? "")}" placeholder="${copy.usernamePlaceholder}" required autofocus>
        <label for="password">${copy.password}</label>
        <input id="password" name="password" type="password" autocomplete="current-password" maxlength="4096" placeholder="${copy.passwordPlaceholder}" required>
        <button type="submit" data-submit data-pending="${copy.submitting}">${copy.submit}</button>
        ${input.remainingAttempts !== undefined ? `<p class="attempts">${copy.attempts(input.remainingAttempts)}</p>` : ""}
      </form>`
    : `<section class="result ${input.state}" aria-live="polite">
        <span class="result-mark" aria-hidden="true">${input.state === "success" ? "✓" : "!"}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </section>`;
  return `<!doctype html>
<html lang="${input.locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} · ${copy.product}</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#637083; --cloud:#f3f6fa; --surface:#fff; --line:#dce3eb; --teal:#087f73; --teal-dark:#06665e; --teal-soft:#e7f5f2; --danger:#b42318; --danger-soft:#fff0ee; --shadow:0 22px 60px rgba(23,32,51,.12); }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:var(--cloud); font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .shell { width:min(980px,calc(100% - 32px)); margin:clamp(24px,7vh,72px) auto; }
    .masthead { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; font-size:13px; letter-spacing:.04em; }
    .brand { font-weight:760; font-size:15px; letter-spacing:-.01em; }
    .session { color:var(--teal-dark); background:var(--teal-soft); padding:7px 11px; border-radius:999px; font-weight:650; }
    .panel { display:grid; grid-template-columns:minmax(270px,.82fr) minmax(340px,1.18fr); overflow:hidden; border:1px solid rgba(23,32,51,.08); border-radius:22px; background:var(--surface); box-shadow:var(--shadow); }
    .context { position:relative; padding:44px 40px; color:#f7fbff; background:var(--ink); }
    .context:after { content:""; position:absolute; width:240px; height:240px; right:-120px; bottom:-130px; border:1px solid rgba(255,255,255,.14); border-radius:50%; box-shadow:0 0 0 34px rgba(255,255,255,.035),0 0 0 72px rgba(255,255,255,.025); }
    .eyebrow { margin:0 0 28px; color:#9edbd4; font-size:12px; font-weight:720; letter-spacing:.11em; text-transform:uppercase; }
    .rail { margin:0; }
    .rail-item { display:grid; grid-template-columns:14px 1fr; gap:0 14px; }
    .rail dt,.rail dd { margin:0; padding-bottom:25px; }
    .rail dt { color:#aeb8c8; font-size:12px; }
    .rail dd { margin-top:18px; font-size:15px; font-weight:650; overflow-wrap:anywhere; }
    .node { position:relative; width:10px; height:10px; margin-top:4px; border:2px solid #73d2c8; border-radius:50%; background:var(--ink); }
    .node:not(.last):after { content:""; position:absolute; left:2px; top:10px; width:2px; height:54px; background:linear-gradient(#3b8f88,rgba(59,143,136,.16)); }
    .target-row { grid-column:2; display:grid; grid-template-columns:76px 1fr; }
    .retention { position:relative; z-index:1; margin:18px 0 0; padding-top:18px; border-top:1px solid rgba(255,255,255,.13); color:#aeb8c8; font-size:12px; line-height:1.55; }
    .content { padding:44px 48px 36px; }
    .content h1 { margin:0 0 10px; font-size:clamp(28px,4vw,38px); line-height:1.08; letter-spacing:-.035em; }
    .intro { margin:0 0 30px; color:var(--muted); line-height:1.65; }
    form { display:grid; gap:9px; }
    label { margin-top:9px; font-size:13px; font-weight:700; }
    input { width:100%; min-height:48px; border:1px solid #cbd4df; border-radius:10px; padding:11px 13px; color:var(--ink); background:#fbfcfe; font:inherit; outline:none; transition:border-color .16s,box-shadow .16s,background .16s; }
    input:focus { border-color:var(--teal); background:#fff; box-shadow:0 0 0 4px rgba(8,127,115,.12); }
    button { min-height:50px; margin-top:17px; border:0; border-radius:10px; color:#fff; background:var(--teal); font:inherit; font-size:15px; font-weight:700; cursor:pointer; transition:background .16s,transform .16s; }
    button:hover { background:var(--teal-dark); }
    button:active { transform:translateY(1px); }
    button:focus-visible { outline:3px solid rgba(8,127,115,.28); outline-offset:3px; }
    button:disabled { cursor:wait; opacity:.72; }
    .alert { margin-bottom:4px; border-left:3px solid var(--danger); border-radius:7px; padding:11px 13px; color:#8d1b13; background:var(--danger-soft); font-size:13px; line-height:1.5; }
    .attempts { margin:2px 0 0; color:var(--muted); text-align:center; font-size:12px; }
    .privacy { display:flex; gap:10px; align-items:flex-start; margin:27px 0 0; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; line-height:1.6; }
    .shield { flex:0 0 auto; color:var(--teal); font-size:15px; line-height:1.3; }
    .result { min-height:280px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; }
    .result-mark { display:grid; place-items:center; width:46px; height:46px; margin-bottom:22px; border-radius:50%; color:#fff; background:var(--danger); font-size:22px; font-weight:800; }
    .result.success .result-mark { background:var(--teal); }
    .result p { max-width:35rem; color:var(--muted); line-height:1.7; }
    @media (max-width:760px) { .shell{width:min(100% - 20px,560px);margin:18px auto}.panel{grid-template-columns:1fr;border-radius:17px}.context{padding:28px 26px 18px}.content{padding:30px 26px}.rail dt,.rail dd{padding-bottom:17px}.node:not(.last):after{height:44px}.content h1{font-size:30px} }
    @media (prefers-reduced-motion:reduce) { *,*:before,*:after{scroll-behavior:auto!important;transition:none!important} }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead"><span class="brand">${copy.product}</span><span class="session">${copy.secureSession}</span></header>
    <section class="panel">
      <aside class="context">
        <p class="eyebrow">${copy.target}</p>
        <dl class="rail">
          <div class="rail-item"><span class="node"></span><div class="target-row"><dt>${copy.instance}</dt><dd>${escapeHtml(maskInstanceId(target?.instanceId, copy.configured))}</dd></div></div>
          <div class="rail-item"><span class="node"></span><div class="target-row"><dt>${copy.region}</dt><dd>${escapeHtml(target?.region ?? copy.unknown)}</dd></div></div>
          <div class="rail-item"><span class="node last"></span><div class="target-row"><dt>${copy.datasource}</dt><dd>${escapeHtml(target?.datasource ?? copy.unknown)}</dd></div></div>
        </dl>
        ${target?.credentialIdleTtlMinutes && target.credentialMaxTtlMinutes ? `<p class="retention">${copy.retention(target.credentialIdleTtlMinutes, target.credentialMaxTtlMinutes)}</p>` : ""}
      </aside>
      <div class="content">
        ${isForm ? `<h1>${copy.title}</h1><p class="intro">${copy.intro}</p>` : ""}
        ${formHtml}
        ${isForm ? `<p class="privacy"><span class="shield" aria-hidden="true">◆</span><span>${copy.privacy}</span></p>` : ""}
      </div>
    </section>
  </main>
  ${isForm ? `<script nonce="${nonce}">document.querySelector('[data-login-form]').addEventListener('submit',()=>{const b=document.querySelector('[data-submit]');b.disabled=true;b.textContent=b.dataset.pending;});</script>` : ""}
</body>
</html>`;
}

function respond(res: ServerResponse, status: number, body: string): void {
  const nonce = /<script nonce="([^"]+)"/.exec(body)?.[1];
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'${nonce ? `; script-src 'nonce-${nonce}'` : ""}`,
    "content-type": "text/html; charset=utf-8",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    expires: "0",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    pragma: "no-cache",
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
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export class LocalCredentialLoginService implements CredentialLoginService {
  private readonly now: () => number;
  private readonly tokenTtlMs: number;
  private readonly maxAttempts: number;
  private readonly failureDelayMs: number;
  private readonly pending = new Map<string, PendingSqlLogin>();
  private server: Server | undefined;
  private port: number | undefined;

  constructor(options: LocalCredentialLoginServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.failureDelayMs = options.failureDelayMs ?? DEFAULT_FAILURE_DELAY_MS;
  }

  async issueSqlLogin(request: SqlLoginRequest): Promise<IssuedSqlLogin> {
    await this.ensureStarted();
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = this.now() + this.tokenTtlMs;
    this.pending.set(token, { ...request, expiresAtMs, failedAttempts: 0, inFlight: false });
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
    const locale = localeFromRequest(req);
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/sql-login\/([^/]+)$/);
      const token = match?.[1];
      const pending = token ? this.pending.get(token) : undefined;

      if (!token || !pending || pending.expiresAtMs <= this.now()) {
        if (token) {
          this.pending.delete(token);
        }
        respond(res, 410, page({ locale, state: "expired", target: pending?.target }));
        return;
      }

      if (req.method === "GET") {
        respond(res, 200, page({
          locale,
          state: "form",
          target: pending.target,
          remainingAttempts: this.maxAttempts - pending.failedAttempts,
        }));
        return;
      }

      if (req.method !== "POST") {
        respond(res, 405, page({ locale, state: "method", target: pending.target }));
        return;
      }
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) {
        respond(res, 403, page({ locale, state: "invalid", target: pending.target }));
        return;
      }
      if (pending.inFlight) {
        respond(res, 409, page({
          locale,
          state: "form",
          target: pending.target,
          message: COPY[locale].busy,
          remainingAttempts: this.maxAttempts - pending.failedAttempts,
        }));
        return;
      }

      const form = new URLSearchParams(await readBody(req));
      const username = form.get("username")?.trim() ?? "";
      const password = form.get("password") ?? "";
      if (!username || !password) {
        respond(res, 400, page({
          locale,
          state: "form",
          target: pending.target,
          message: COPY[locale].required,
          username,
          remainingAttempts: this.maxAttempts - pending.failedAttempts,
        }));
        return;
      }

      try {
        pending.inFlight = true;
        await pending.bind({ datasource: pending.datasource, username, password });
      } catch (error) {
        pending.inFlight = false;
        const kind = error instanceof SqlCredentialValidationError ? error.kind : "connectivity";
        if (kind === "credentials") {
          pending.failedAttempts += 1;
          await delay(this.failureDelayMs * 2 ** (pending.failedAttempts - 1));
          if (pending.failedAttempts >= this.maxAttempts) {
            this.pending.delete(token);
            respond(res, 429, page({ locale, state: "locked", target: pending.target }));
            return;
          }
        }
        respond(res, kind === "credentials" ? 401 : kind === "timeout" ? 504 : 502, page({
          locale,
          state: "form",
          target: pending.target,
          message: COPY[locale][kind],
          username,
          remainingAttempts: this.maxAttempts - pending.failedAttempts,
        }));
        return;
      }

      this.pending.delete(token);
      respond(res, 200, page({ locale, state: "success", target: pending.target }));
    } catch {
      respond(res, 400, page({ locale, state: "invalid" }));
    }
  }
}
