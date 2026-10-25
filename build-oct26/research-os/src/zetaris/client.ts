import { randomUUID } from "node:crypto";

// Zetaris direct REST API, as documented in the participant guide (section
// 1.9) and zetaris/getting-started scripts/zetaris_sql.py:
//   POST <ZETARIS_REST_URL>/sql-editor/sqls/run
//   Authorization: Bearer <API key>, X-Org-ID, X-Request-ID (fresh UUID)
//   body {queryId (UUID), sql, source: "SqlEditor", limit} -> {data: rows[][]}
// REST returns values as strings; callers convert them.

export interface ZetarisConfig {
  restUrl: string;
  orgId: string;
  apiKey: string;
  limit: number;
}

export type FetchLike = typeof fetch;

const DEFAULT_REST_URL = "http://localhost:8888/api/v1.0";
const TIMEOUT_MS = 120_000;

export function zetarisConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ZetarisConfig {
  const missing = ["ZETARIS_API_KEY", "ZETARIS_ORG_ID"].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`DATA_SOURCE=zetaris needs ${missing.join(" and ")} in build-oct26/.env (or use DATA_SOURCE=local)`);
  }
  const limit = Number(env.ZETARIS_QUERY_LIMIT ?? "1000");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("ZETARIS_QUERY_LIMIT must be a positive integer");
  return {
    restUrl: (env.ZETARIS_REST_URL?.trim() || DEFAULT_REST_URL).replace(/\/+$/, ""),
    orgId: env.ZETARIS_ORG_ID!.trim(),
    apiKey: env.ZETARIS_API_KEY!.trim(),
    limit,
  };
}

export class ZetarisClient {
  constructor(readonly config: ZetarisConfig, private readonly fetchImpl: FetchLike = fetch) {}

  // Lightning SQL accepts one statement per call.
  async runSql(sql: string, limit = this.config.limit): Promise<unknown[][]> {
    const url = `${this.config.restUrl}/sql-editor/sqls/run`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-Org-ID": this.config.orgId,
          "X-Request-ID": randomUUID(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Zetaris isn't reachable at ${this.config.restUrl} (${error instanceof Error ? error.message : error}). ` +
          "Is it running? Check `docker compose ps --all` in zetaris-platform, or use DATA_SOURCE=local.",
      );
    }

    const text = await response.text();
    if (!response.ok) {
      const detail = text.slice(0, 300);
      if (response.status === 401) {
        throw new Error(`Zetaris rejected the API key (HTTP 401). Create a new key in the Zetaris web interface and update ZETARIS_API_KEY. ${detail}`);
      }
      if (response.status === 400 && /not allowed/i.test(text)) {
        throw new Error(`Zetaris refused the organisation (HTTP 400). Check ZETARIS_ORG_ID (1 on a local install). ${detail}`);
      }
      throw new Error(`Zetaris query failed (HTTP ${response.status}): ${detail}`);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Zetaris returned non-JSON from ${url}: ${text.slice(0, 120)}`);
    }
    const data = (body as { data?: unknown } | null)?.data;
    if (data === undefined || data === null) return [];
    if (!Array.isArray(data) || !data.every(Array.isArray)) {
      throw new Error(`Zetaris returned an unexpected result shape: ${text.slice(0, 120)}`);
    }
    return data as unknown[][];
  }
}

// REST values arrive as strings (decimals may use exponent form).
export function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function asNullableText(value: unknown): string | null {
  return value === null || value === undefined || value === "" || value === "null" ? null : String(value);
}

export function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) throw new Error(`Zetaris returned a non-numeric value: ${JSON.stringify(value)}`);
  return n;
}

export function asNullableNumber(value: unknown): number | null {
  return asNullableText(value) === null ? null : asNumber(value);
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value).toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  throw new Error(`Zetaris returned a non-boolean value: ${JSON.stringify(value)}`);
}
