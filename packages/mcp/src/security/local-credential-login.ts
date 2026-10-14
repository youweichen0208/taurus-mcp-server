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

export type SqlLoginBindContext = {
  /**
   * True while this login link is still unexpired and has not been revoked.
   * Callers must re-check it after acquiring their session lock and before
   * sending the submitted credential anywhere.
   */
  isActive: () => boolean;
};

export type SqlLoginRequest = {
  datasource: string;
  target?: SqlLoginTarget;
  bind: (credentials: SqlLoginCredentials, context: SqlLoginBindContext) => Promise<void>;
};

export type IssuedSqlLogin = {
  loginUrl: string;
  expiresAt: string;
};

export type CredentialValidationFailure =
  | "credentials"
  | "unreachable"
  | "refused"
  | "connectivity"
  | "tls"
  | "timeout"
  | "stale";

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
  /** Invalidate outstanding login links for one datasource, or for all datasources. */
  revoke(datasource?: string): void;
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
  failures: number;
  inFlight: boolean;
  revoked: boolean;
};

const MAX_BACKOFF_EXPONENT = 4;

type Locale = "zh-CN" | "en";
type PageState = "form" | "success" | "expired" | "locked" | "method" | "invalid";

const COPY = {
  "zh-CN": {
    product: "TaurusDB MCP",
    language: "语言",
    title: "连接数据库",
    intro: "输入数据库账号和密码以验证连接。",
    username: "数据库账号",
    password: "数据库密码",
    usernamePlaceholder: "请输入数据库账号",
    passwordPlaceholder: "请输入数据库密码",
    submit: "连接数据库",
    submitting: "正在验证连接…",
    targetInstance: "目标实例",
    targetDetail: (region: string | undefined, datasource: string) =>
      region ? `区域 ${region}，数据源 ${datasource}` : `数据源 ${datasource}`,
    targetDatasource: "已配置的数据源",
    pathLabel: "凭据的传递路径",
    pathBrowser: "此浏览器",
    pathMcp: "本机 MCP",
    pathDatabase: "数据库",
    privacy: "密码从这个页面直接交给本机的 MCP 进程。AI 助手看不到它，MCP 也不会把它保存到磁盘。",
    retention: (idle: number, maximum: number) => `空闲 ${idle} 分钟后自动清除登录，最长保留 ${maximum >= 60 ? `${maximum / 60} 小时` : `${maximum} 分钟`}。`,
    attempts: (remaining: number) => `本链接还可尝试 ${remaining} 次`,
    required: "请输入数据库账号和密码。",
    credentials: "无法验证账号信息，请检查账号和密码。",
    unreachable: "无法访问数据库公网地址。请检查实例安全组入方向规则是否已向当前公网出口 IP 放通数据库端口，并检查网络 ACL、VPN 和本机出口防火墙。",
    refused: "数据库公网地址可以访问，但端口拒绝连接。请检查实例状态和数据库端口。",
    connectivity: "数据库连接失败，请检查公网地址、实例状态和网络配置。",
    tls: "TLS 安全连接验证失败，请联系管理员检查证书配置。",
    timeout: "数据库端口已连接，但验证未在限定时间内完成。请检查实例负载、连接数和数据库状态。",
    busy: "连接正在验证，请勿重复提交。",
    stale: "连接目标已变更或登录已被清除，此链接已失效。请返回 MCP 会话重新生成登录链接。",
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
    language: "Language",
    title: "Connect to database",
    intro: "Enter your database credentials to validate the connection.",
    username: "Database username",
    password: "Database password",
    usernamePlaceholder: "Enter database username",
    passwordPlaceholder: "Enter database password",
    submit: "Connect to database",
    submitting: "Validating connection…",
    targetInstance: "Target instance",
    targetDetail: (region: string | undefined, datasource: string) =>
      region ? `Region ${region}, datasource ${datasource}` : `Datasource ${datasource}`,
    targetDatasource: "Configured datasource",
    pathLabel: "Where your credentials go",
    pathBrowser: "This browser",
    pathMcp: "Local MCP",
    pathDatabase: "Database",
    privacy: "Your password goes straight from this page to the MCP process on this computer. The AI assistant never sees it, and MCP does not save it to disk.",
    retention: (idle: number, maximum: number) => `The login is cleared after ${idle} idle minutes and kept for at most ${maximum >= 60 ? `${maximum / 60} ${maximum === 60 ? "hour" : "hours"}` : `${maximum} ${maximum === 1 ? "minute" : "minutes"}`}.`,
    attempts: (remaining: number) => `${remaining} attempts remaining for this link`,
    required: "Enter both the database username and password.",
    credentials: "The account could not be validated. Check the username and password.",
    unreachable: "The public database endpoint is unreachable. Allow the database port from this client's public egress IP in the instance security group's inbound rules, then check network ACL, VPN, and outbound firewall rules.",
    refused: "The public database endpoint is reachable, but the port refused the connection. Check the instance status and database port.",
    connectivity: "The database connection failed. Check the public endpoint, instance status, and network configuration.",
    tls: "The TLS connection could not be validated. Ask an administrator to check the certificate configuration.",
    timeout: "The database port connected, but validation did not finish in time. Check instance load, connection capacity, and database status.",
    busy: "Connection validation is already in progress. Do not submit again.",
    stale: "The connection target changed or the login was cleared, so this link is no longer valid. Return to your MCP session and create a new login link.",
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

/**
 * The page is Chinese unless the user picks English with `?lang=en`. The
 * browser's Accept-Language is deliberately ignored so the default is stable.
 */
function localeFromUrl(url: URL | undefined): Locale {
  return url?.searchParams.get("lang")?.toLowerCase().startsWith("en") ? "en" : "zh-CN";
}

function languageSwitch(locale: Locale): string {
  const option = (target: Locale, label: string) =>
    target === locale
      ? `<span class="lang-option" aria-current="true">${label}</span>`
      : `<a class="lang-option" href="?lang=${target}" hreflang="${target}">${label}</a>`;
  return `<nav class="lang-switch" aria-label="${COPY[locale].language}">${option("zh-CN", "中文")}<span aria-hidden="true">/</span>${option("en", "English")}</nav>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(input: {
  locale: Locale;
  state: PageState;
  target?: SqlLoginTarget;
  message?: string;
  errorCode?: string;
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
  // The instance ID gets its own line: real IDs are 30+ characters and would
  // otherwise break the surrounding sentence.
  const id = (value: string) => `<code>${escapeHtml(value)}</code>`;
  const targetSentence = target?.instanceId
    ? `<span class="target-name">${copy.targetInstance} ${id(target.instanceId)}</span><span>${copy.targetDetail(target.region ? escapeHtml(target.region) : undefined, id(target.datasource))}</span>`
    : target?.datasource
      ? `<span class="target-name">${copy.targetDatasource} ${id(target.datasource)}</span>`
      : "";
  const retention = target?.credentialIdleTtlMinutes && target.credentialMaxTtlMinutes
    ? `<p class="retention">${copy.retention(target.credentialIdleTtlMinutes, target.credentialMaxTtlMinutes)}</p>`
    : "";
  const formHtml = `<h1>${copy.title}</h1>
        ${targetSentence ? `<p class="target">${targetSentence}</p>` : ""}
        <figure class="path" aria-labelledby="path-caption">
          <ol class="path-nodes" aria-label="${copy.pathLabel}">
            <li>${copy.pathBrowser}</li>
            <li class="path-local">${copy.pathMcp}<code>127.0.0.1</code></li>
            <li>${copy.pathDatabase}</li>
          </ol>
          <figcaption id="path-caption">${copy.privacy}</figcaption>
        </figure>
        <form method="post" action="?lang=${input.locale}" autocomplete="on" data-login-form>
          ${input.message ? `<div class="alert" role="alert">
            ${input.errorCode ? `<code class="alert-code">${escapeHtml(input.errorCode)}</code>` : ""}
            <p>${escapeHtml(input.message)}</p>
          </div>` : ""}
          <div class="field">
            <label for="username">${copy.username}</label>
            <input id="username" name="username" autocomplete="username" maxlength="256" value="${escapeHtml(input.username ?? "")}" placeholder="${copy.usernamePlaceholder}" required autofocus>
          </div>
          <div class="field">
            <label for="password">${copy.password}</label>
            <input id="password" name="password" type="password" autocomplete="current-password" maxlength="4096" placeholder="${copy.passwordPlaceholder}" required>
          </div>
          <button type="submit" data-submit data-pending="${copy.submitting}">${copy.submit}</button>
          ${input.remainingAttempts !== undefined ? `<p class="attempts">${copy.attempts(input.remainingAttempts)}</p>` : ""}
        </form>
        ${retention}`;
  const resultHtml = `<section class="result ${input.state}" aria-live="polite">
        <span class="result-mark" aria-hidden="true">${input.state === "success" ? "✓" : "!"}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${input.state === "success" && targetSentence ? `<p class="target">${targetSentence}</p>` : ""}
      </section>`;
  return `<!doctype html>
<html lang="${input.locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} · ${copy.product}</title>
  <style>
    :root { color-scheme:light; --canvas:#e9edf1; --surface:#fff; --ink:#1b2430; --muted:#5b6673; --line:#d5dbe2; --field:#f7f9fb; --pine:#0e6b5a; --pine-dark:#0a5546; --pine-soft:#e3f1ec; --danger:#b42318; --danger-soft:#fdedeb; --sans:system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:var(--canvas); font:15px/1.6 var(--sans); }
    .shell { width:min(440px,calc(100% - 32px)); margin:clamp(24px,9vh,96px) auto 40px; }
    .masthead { display:flex; justify-content:space-between; align-items:baseline; margin:0 4px 14px; }
    .brand { font-size:14px; font-weight:650; }
    .lang-switch { display:flex; gap:8px; color:var(--muted); font-size:13px; }
    .lang-option { color:var(--muted); text-decoration:none; border-radius:4px; }
    a.lang-option:hover { color:var(--pine); text-decoration:underline; }
    .lang-option[aria-current="true"] { color:var(--ink); font-weight:600; }
    .card { padding:32px; border:1px solid var(--line); border-radius:14px; background:var(--surface); box-shadow:0 1px 2px rgba(27,36,48,.06),0 12px 32px rgba(27,36,48,.08); }
    h1 { margin:0; font-size:26px; font-weight:650; line-height:1.25; letter-spacing:-.01em; }
    code { font-family:var(--mono); font-size:.9em; overflow-wrap:anywhere; }
    .target { display:grid; gap:2px; margin:10px 0 0; color:var(--muted); font-size:14px; }
    .target code { color:var(--ink); }
    .target-name code { font-size:14px; font-weight:600; }
    .path { margin:24px 0 28px; padding:18px 16px 16px; border-radius:10px; background:var(--pine-soft); }
    .path-nodes { position:relative; display:grid; grid-template-columns:repeat(3,1fr); margin:0; padding:0; list-style:none; text-align:center; font-size:13px; font-weight:600; color:var(--pine-dark); }
    .path-nodes:before { content:""; position:absolute; top:6px; left:16.7%; right:16.7%; height:2px; background:var(--pine); }
    .path-nodes li { position:relative; display:grid; justify-items:center; gap:2px; padding-top:20px; }
    .path-nodes li:before { content:""; position:absolute; top:0; left:50%; width:14px; height:14px; margin-left:-7px; border:2px solid var(--pine); border-radius:50%; background:var(--pine-soft); }
    .path-nodes .path-local:before { background:var(--pine); }
    .path-nodes code { font-size:11.5px; font-weight:500; color:var(--pine); }
    .path figcaption { margin-top:14px; color:var(--pine-dark); font-size:13px; line-height:1.6; }
    form { display:grid; gap:16px; }
    .field { display:grid; gap:6px; }
    label { font-size:13px; font-weight:600; }
    input { width:100%; min-height:46px; padding:10px 12px; border:1px solid #c3ccd6; border-radius:8px; color:var(--ink); background:var(--field); font:inherit; }
    input::placeholder { color:#8a94a0; }
    input:focus { outline:none; border-color:var(--pine); background:#fff; box-shadow:0 0 0 3px rgba(14,107,90,.18); }
    button { min-height:46px; margin-top:4px; border:0; border-radius:8px; color:#fff; background:var(--pine); font:inherit; font-weight:600; cursor:pointer; }
    button:hover { background:var(--pine-dark); }
    button:disabled { cursor:progress; opacity:.75; }
    a:focus-visible, button:focus-visible { outline:3px solid rgba(14,107,90,.35); outline-offset:2px; }
    .attempts { margin:-6px 0 0; color:var(--muted); font-size:13px; text-align:center; }
    .alert { padding:12px 14px; border-left:3px solid var(--danger); border-radius:6px; color:#7a1a12; background:var(--danger-soft); font-size:14px; line-height:1.55; }
    .alert p { margin:0; }
    .alert-code { display:inline-block; margin-bottom:4px; color:var(--danger); font-size:12px; font-weight:600; }
    .retention { margin:22px 0 0; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
    .result { display:grid; justify-items:start; gap:10px; }
    .result p { margin:0; color:var(--muted); }
    .result-mark { display:grid; place-items:center; width:40px; height:40px; margin-bottom:6px; border-radius:50%; color:#fff; background:var(--danger); font-size:20px; font-weight:700; }
    .result.success .result-mark { background:var(--pine); }
    @media (max-width:480px) { .card { padding:24px 20px; } h1 { font-size:23px; } .target-name code { font-size:12.5px; } .path-nodes { font-size:12px; } }
    @media (prefers-reduced-motion:reduce) { * { transition:none!important; animation:none!important; } }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead"><span class="brand">${copy.product}</span>${isForm ? languageSwitch(input.locale) : ""}</header>
    <div class="card">
      ${isForm ? formHtml : resultHtml}
    </div>
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

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "[::1]";
}

function isAllowedBrowserRequest(req: IncomingMessage, port: number | undefined): boolean {
  if (!port) return false;

  try {
    const requestUrl = new URL(`http://${req.headers.host ?? ""}`);
    if (!isLoopbackHostname(requestUrl.hostname) || requestUrl.port !== String(port)) {
      return false;
    }
  } catch {
    return false;
  }

  const origin = req.headers.origin;
  if (!origin || origin === "null") return true;

  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "http:"
      && isLoopbackHostname(originUrl.hostname)
      && originUrl.port === String(port);
  } catch {
    return false;
  }
}

function validationErrorCode(kind: CredentialValidationFailure): string {
  switch (kind) {
    case "credentials": return "DB_AUTH_FAILED";
    case "unreachable": return "DB_ENDPOINT_UNREACHABLE";
    case "refused": return "DB_CONNECTION_REFUSED";
    case "tls": return "DB_TLS_FAILED";
    case "timeout": return "DB_VALIDATION_TIMEOUT";
    case "stale": return "LOGIN_LINK_REVOKED";
    default: return "DB_CONNECTION_FAILED";
  }
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
    this.pending.set(token, {
      ...request,
      expiresAtMs,
      failedAttempts: 0,
      failures: 0,
      inFlight: false,
      revoked: false,
    });
    return {
      loginUrl: `http://127.0.0.1:${this.port}/sql-login/${token}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  revoke(datasource?: string): void {
    for (const [token, pending] of this.pending) {
      if (datasource === undefined || pending.datasource === datasource) {
        pending.revoked = true;
        this.pending.delete(token);
      }
    }
  }

  async close(): Promise<void> {
    this.revoke();
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

  private isActive(token: string, pending: PendingSqlLogin): boolean {
    return (
      !pending.revoked &&
      this.pending.get(token) === pending &&
      pending.expiresAtMs > this.now()
    );
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
    let url: URL | undefined;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      url = undefined;
    }
    const locale = localeFromUrl(url);
    try {
      if (!url) {
        throw new Error("Invalid request URL.");
      }
      const match = url.pathname.match(/^\/sql-login\/([^/]+)$/);
      const token = match?.[1];
      const pending = token ? this.pending.get(token) : undefined;

      if (!token || !pending || pending.expiresAtMs <= this.now()) {
        if (token) {
          this.pending.delete(token);
        }
        respond(res, 200, page({ locale, state: "expired", target: pending?.target }));
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
      if (!isAllowedBrowserRequest(req, this.port)) {
        respond(res, 403, page({ locale, state: "invalid", target: pending.target }));
        return;
      }
      if (pending.inFlight) {
        respond(res, 200, page({
          locale,
          state: "form",
          target: pending.target,
          message: COPY[locale].busy,
          remainingAttempts: this.maxAttempts - pending.failedAttempts,
        }));
        return;
      }

      // Claim the link before awaiting anything so concurrent submissions cannot
      // both reach credential validation.
      pending.inFlight = true;
      try {
        const form = new URLSearchParams(await readBody(req));
        if (!this.isActive(token, pending)) {
          this.pending.delete(token);
          respond(res, 200, page({
            locale,
            state: "expired",
            target: pending.target,
            message: pending.revoked ? COPY[locale].stale : undefined,
          }));
          return;
        }
        const username = form.get("username")?.trim() ?? "";
        const password = form.get("password") ?? "";
        if (!username || !password) {
          respond(res, 200, page({
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
          await pending.bind(
            { datasource: pending.datasource, username, password },
            { isActive: () => this.isActive(token, pending) },
          );
        } catch (error) {
          const kind = error instanceof SqlCredentialValidationError ? error.kind : "connectivity";
          if (kind === "stale") {
            pending.revoked = true;
            this.pending.delete(token);
            respond(res, 200, page({
              locale,
              state: "expired",
              target: pending.target,
              message: COPY[locale].stale,
            }));
            return;
          }
          pending.failures += 1;
          if (kind === "credentials") {
            pending.failedAttempts += 1;
          }
          // Keep the link claimed while backing off so failures of any kind are
          // rate limited, not only authentication failures.
          await delay(
            this.failureDelayMs * 2 ** Math.min(pending.failures - 1, MAX_BACKOFF_EXPONENT),
          );
          if (pending.failedAttempts >= this.maxAttempts) {
            this.pending.delete(token);
            respond(res, 200, page({ locale, state: "locked", target: pending.target }));
            return;
          }
          if (!this.isActive(token, pending)) {
            this.pending.delete(token);
            respond(res, 200, page({ locale, state: "expired", target: pending.target }));
            return;
          }
          respond(res, 200, page({
            locale,
            state: "form",
            target: pending.target,
            message: COPY[locale][kind],
            errorCode: validationErrorCode(kind),
            username,
            remainingAttempts: this.maxAttempts - pending.failedAttempts,
          }));
          return;
        }

        this.pending.delete(token);
        respond(res, 200, page({ locale, state: "success", target: pending.target }));
      } finally {
        // Consumed and revoked links are already removed from the map, so this
        // only re-opens a link that remains eligible for another attempt.
        pending.inFlight = false;
      }
    } catch {
      respond(res, 400, page({ locale, state: "invalid" }));
    }
  }
}
