import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ZetarisClientError,
  type ZetarisColumn,
  type ZetarisConnection,
  type ZetarisErrorKind,
  type ZetarisQueryResult,
} from "./types.ts";

const LOGIN_PATH = "/api/auth/login";
const DATABASES_PATH = "/api/proxy/lightning-database/databases";
const QUERY_PATH = "/api/proxy/sql-editor/sqls/run-query";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_LIMIT = 1000;
const JWT_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const ORIGIN_PATTERN = /^https?:\/\/[^/]+$/;

interface ZetarisSettings {
  baseUrl: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
  queryLimit: number;
  engineId?: string;
}

export class ZetarisClient {
  #baseUrl: string;
  #orgId: string;
  #apiKey?: string;
  #username?: string;
  #password?: string;
  #queryLimit: number;
  #engineId?: string;
  #token?: string;

  private constructor(settings: ZetarisSettings) {
    this.#baseUrl = settings.baseUrl;
    this.#orgId = settings.orgId;
    this.#apiKey = settings.apiKey;
    this.#username = settings.username;
    this.#password = settings.password;
    this.#queryLimit = settings.queryLimit;
    this.#engineId = settings.engineId;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ZetarisClient {
    return new ZetarisClient(readSettings(env));
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "ZetarisClient";
  }

  async connect(): Promise<ZetarisConnection> {
    await this.#ensureToken();
    const payload = await this.#request(DATABASES_PATH, "GET", undefined, this.#token);
    return { databaseCount: databaseCount(payload) };
  }

  async query(sql: string): Promise<ZetarisQueryResult> {
    const statement = sql.trim();
    if (!statement) {
      throw new ZetarisClientError("query", "SQL must not be empty.");
    }
    await this.#ensureToken();
    const payload = await this.#request(QUERY_PATH, "POST", {
      sql: statement,
      limit: this.#queryLimit,
      ...(this.#engineId ? { engineId: this.#engineId } : {}),
    }, this.#token);
    return normalizeQueryResult(payload, (text) => this.#redact(text));
  }

  async #ensureToken(): Promise<void> {
    if (this.#token) return;
    if (this.#apiKey) {
      this.#token = this.#apiKey;
      return;
    }
    const username = this.#username;
    const password = this.#password;
    if (!username || !password) {
      throw new ZetarisClientError(
        "config",
        "Set ZETARIS_API_KEY or both ZETARIS_USERNAME and ZETARIS_PASSWORD.",
      );
    }
    const login = await this.#request(LOGIN_PATH, "POST", { username, password });
    const token = readAccessToken(login);
    if (!token) {
      throw new ZetarisClientError("auth", "Zetaris login did not return an access token.");
    }
    this.#token = token;
  }

  async #request(requestPath: string, method: string, body?: unknown, token?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      "X-Request-ID": crypto.randomUUID(),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["X-Org-ID"] = this.#orgId;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${requestPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "request failed";
      throw new ZetarisClientError("connection", `Cannot reach ${this.#baseUrl}: ${this.#redact(reason)}`);
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      throw new ZetarisClientError(
        errorKind(requestPath, response.status),
        this.#failureMessage(method, requestPath, response.status, contentType, text),
      );
    }
    if (response.status === 204 || text.length === 0) return null;
    if (!contentType.includes("json")) {
      throw new ZetarisClientError(
        errorKind(requestPath, response.status),
        this.#failureMessage(method, requestPath, response.status, contentType, text),
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ZetarisClientError(errorKind(requestPath, response.status), `${method} ${requestPath} returned invalid JSON.`);
    }
  }

  #failureMessage(method: string, requestPath: string, status: number, contentType: string, text: string): string {
    const prefix = requestPath === LOGIN_PATH
      ? `Zetaris login failed: HTTP ${status}`
      : `${method} ${requestPath} failed: HTTP ${status}`;
    const detail = contentType.includes("text/html")
      ? "The server returned an HTML page; check the API route."
      : this.#redact(text).slice(0, 500);
    const hint = status === 404
      ? " ZETARIS_BASE_URL must be the web UI origin, not the direct API address."
      : "";
    return detail ? `${prefix} ${detail}${hint}` : `${prefix}${hint}`;
  }

  #redact(text: string): string {
    let redacted = text.replace(JWT_PATTERN, "[redacted]");
    for (const secret of [this.#apiKey, this.#password, this.#token]) {
      if (!secret) continue;
      redacted = redacted.split(secret).join("[redacted]");
    }
    return redacted.replace(/"(?:password|apiKey|api_key|accessToken|idToken|refreshToken|token)"\s*:\s*"(?:[^"\\]|\\.)*"/gi, (match) => {
      const key = match.slice(1, match.indexOf('"', 1));
      return `"${key}":"[redacted]"`;
    });
  }
}

function readSettings(env: NodeJS.ProcessEnv): ZetarisSettings {
  const baseUrl = (env.ZETARIS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ZetarisClientError("config", "Set ZETARIS_BASE_URL to the web UI origin.");
  }
  if (!ORIGIN_PATTERN.test(baseUrl)) {
    throw new ZetarisClientError("config", "ZETARIS_BASE_URL must be an HTTP(S) origin without a path.");
  }

  const orgId = (env.ZETARIS_ORG_ID ?? "").trim();
  if (!/^\d+$/.test(orgId)) {
    throw new ZetarisClientError("config", "Set ZETARIS_ORG_ID to the numeric organisation ID.");
  }

  const apiKey = blankToUndefined(env.ZETARIS_API_KEY);
  const username = blankToUndefined(env.ZETARIS_USERNAME);
  const password = env.ZETARIS_PASSWORD;
  const passwordPresent = password !== undefined && password !== "";
  if (!apiKey && (!username || !passwordPresent)) {
    throw new ZetarisClientError(
      "config",
      "Set ZETARIS_API_KEY or both ZETARIS_USERNAME and ZETARIS_PASSWORD.",
    );
  }

  return {
    baseUrl,
    orgId,
    apiKey,
    username,
    password: passwordPresent ? password : undefined,
    queryLimit: readQueryLimit(env.ZETARIS_QUERY_LIMIT),
    engineId: blankToUndefined(env.ZETARIS_ENGINE_ID),
  };
}

function readQueryLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_QUERY_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ZetarisClientError("config", "ZETARIS_QUERY_LIMIT must be a positive integer.");
  }
  return limit;
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function errorKind(requestPath: string, status: number): ZetarisErrorKind {
  if (requestPath === LOGIN_PATH || status === 401 || status === 403) return "auth";
  if (requestPath === QUERY_PATH) return "query";
  return "connection";
}

function readAccessToken(login: unknown): string | null {
  if (login && typeof login === "object") {
    const record = login as Record<string, unknown>;
    const direct = record.idToken ?? record.token ?? record.accessToken;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  const serialized = JSON.stringify(login) ?? "";
  return serialized.match(JWT_PATTERN)?.[0] ?? null;
}

function databaseCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  const record = asRecord(payload);
  if (record) {
    for (const key of ["data", "databases", "items"]) {
      if (Array.isArray(record[key])) return record[key].length;
    }
  }
  throw new ZetarisClientError("connection", "Unexpected database-list response.");
}

function normalizeQueryResult(payload: unknown, redact: (text: string) => string): ZetarisQueryResult {
  if (Array.isArray(payload)) return rowsFromObjects(payload);
  const record = asRecord(payload);
  if (!record) {
    throw new ZetarisClientError("query", "Zetaris query returned an unexpected response.");
  }

  const failure = queryFailure(record);
  if (failure) throw new ZetarisClientError("query", redact(failure));

  const headerSource = record.headers ?? record.columns;
  const rowSource = record.data ?? record.rows ?? record.result;
  if (Array.isArray(rowSource) && rowSource.every((row) => Array.isArray(row))) {
    return {
      columns: readColumns(headerSource, rowSource[0]?.length ?? 0),
      rows: rowSource,
    };
  }
  if (Array.isArray(rowSource)) return rowsFromObjects(rowSource, headerSource);
  if (rowSource === undefined || rowSource === null) {
    return { columns: readColumns(headerSource, 0), rows: [] };
  }
  throw new ZetarisClientError("query", "Zetaris query returned an unexpected response.");
}

function queryFailure(record: Record<string, unknown>): string | null {
  const status = record.status;
  const failed = typeof status === "string" && /fail|error/i.test(status) && !/success/i.test(status);
  const error = record.error ?? record.errorMessage;
  if (typeof error === "string" && error.trim()) return error.trim();
  const errorRecord = asRecord(error);
  if (errorRecord && typeof errorRecord.message === "string" && errorRecord.message.trim()) {
    return errorRecord.message.trim();
  }
  if (failed && typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return null;
}

function rowsFromObjects(rows: unknown[], headerSource?: unknown): ZetarisQueryResult {
  const objects = rows.map((row) => asRecord(row) ?? {});
  const names = readColumns(headerSource, 0).map((column) => column.name);
  const columnNames = names.length > 0 ? names : [...new Set(objects.flatMap((row) => Object.keys(row)))];
  return {
    columns: columnNames.map((name) => ({ name })),
    rows: objects.map((row) => columnNames.map((name) => row[name] ?? null)),
  };
}

function readColumns(headerSource: unknown, width: number): ZetarisColumn[] {
  if (!Array.isArray(headerSource)) {
    return Array.from({ length: width }, (_, index) => ({ name: `column_${index + 1}` }));
  }
  return headerSource.map((header, index) => {
    if (typeof header === "string" && header.trim()) return { name: header };
    const record = asRecord(header);
    const name = record?.name ?? record?.columnName ?? record?.header;
    const type = record?.type ?? record?.dataType;
    return {
      name: typeof name === "string" && name.trim() ? name : `column_${index + 1}`,
      ...(typeof type === "string" && type.trim() ? { type } : {}),
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryUrl = pathToFileURL(path.resolve(entry)).href;
  return process.platform === "win32"
    ? import.meta.url.toLowerCase() === entryUrl.toLowerCase()
    : import.meta.url === entryUrl;
}

if (isDirectRun()) {
  try {
    const client = ZetarisClient.fromEnv();
    const connection = await client.connect();
    const query = await client.query("SELECT 1");
    console.log(JSON.stringify({ connection, query }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zetaris request failed.";
    console.error(message);
    process.exitCode = 1;
  }
}
