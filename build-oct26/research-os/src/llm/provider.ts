// Model provider for ResearchOS (the hackathon's Power layer). Primary route:
// Meterless Runtime (Nightshift), implementing provider contract v4 from
// meterless.ai/engines.html "Add Meterless as a provider":
//   - base URL normalised to <host>/v1 (default http://127.0.0.1:8088/v1)
//   - Authorization: Bearer <runtime token> on every call; "rt-local" rejected
//   - meterless-app on every request, meterless-scope: user on chat
//   - GET /v1/models decides status: 401/403 unauthorized, 200 with meterless
//     ids online, anything else offline
//   - 180 s chat timeout; only a transport failure may fall back to another route
// Secondary route: any OpenAI-compatible endpoint from the guide's smoke test
// variables (MODEL_BASE_URL, MODEL_API_KEY, NEMOTRON_MODEL), such as NVIDIA's API.

export type RouteId = "meterless" | "direct";

export interface ModelRoute {
  id: RouteId;
  baseUrl: string;
  token: string;
  model: string;
}

export type RouteStatus = "online" | "unauthorized" | "offline";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

export type FetchLike = typeof fetch;

export const METERLESS_APP_ID = "research-os";
export const DEFAULT_METERLESS_BASE_URL = "http://127.0.0.1:8088/v1";
const PLACEHOLDER_TOKEN = "rt-local";
const CHAT_TIMEOUT_MS = 180_000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const AUTO_DETECT_PORTS = [8088, 8090, 8787, 11434];
const AUTO_DETECT_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly route: RouteId,
    readonly transport: boolean,
    readonly status?: number,
    readonly code?: string,
    readonly fix?: string[],
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// Accepts a pasted URL with or without a scheme, /v1, /v1/chat/completions,
// /v1/models or /healthz, and returns <host>/v1 (never /v1/v1).
export function normalizeMeterlessBaseUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  return `${url.protocol}//${url.host}/v1`;
}

// http://<host>:<port>/connect#k=<key> -> base URL and runtime token.
export function parseConnectLink(link: string): { baseUrl: string; token?: string } | undefined {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(link.trim()) ? link.trim() : `http://${link.trim()}`);
  } catch {
    return undefined;
  }
  if (url.pathname.replace(/\/+$/, "") !== "/connect") return undefined;
  const token = new URLSearchParams(url.hash.replace(/^#/, "")).get("k") ?? undefined;
  return { baseUrl: `${url.protocol}//${url.host}/v1`, token: token || undefined };
}

export interface RouteResolution {
  primary?: ModelRoute;
  fallback?: ModelRoute;
  problems: string[];
  forcedOffline: boolean;
}

export function resolveRoutes(env: NodeJS.ProcessEnv = process.env): RouteResolution {
  const problems: string[] = [];
  const choice = (env.RESEARCH_OS_MODEL_ROUTE ?? "auto").trim().toLowerCase();
  if (!["auto", "meterless", "direct", "offline"].includes(choice)) {
    problems.push(`RESEARCH_OS_MODEL_ROUTE must be auto, meterless, direct or offline (got "${choice}")`);
  }
  if (choice === "offline") return { problems, forcedOffline: true };

  let meterless: ModelRoute | undefined;
  const link = env.METERLESS_BASE_URL ? parseConnectLink(env.METERLESS_BASE_URL) : undefined;
  const token = (env.METERLESS_RUNTIME_TOKEN ?? link?.token ?? "").trim();
  if (token === PLACEHOLDER_TOKEN) {
    problems.push(`METERLESS_RUNTIME_TOKEN is the placeholder "${PLACEHOLDER_TOKEN}"; copy the real token from the Nightshift Console`);
  } else if (token) {
    meterless = {
      id: "meterless",
      baseUrl: link?.baseUrl ?? normalizeMeterlessBaseUrl(env.METERLESS_BASE_URL || DEFAULT_METERLESS_BASE_URL),
      token,
      model: env.METERLESS_MODEL?.trim() || "meterless/auto",
    };
  }

  let direct: ModelRoute | undefined;
  const directVars = ["MODEL_BASE_URL", "MODEL_API_KEY", "NEMOTRON_MODEL"];
  const directSet = directVars.filter((name) => env[name]?.trim());
  if (directSet.length === directVars.length) {
    direct = {
      id: "direct",
      baseUrl: env.MODEL_BASE_URL!.trim().replace(/\/+$/, ""),
      token: env.MODEL_API_KEY!.trim(),
      model: env.NEMOTRON_MODEL!.trim(),
    };
  } else if (directSet.length > 0) {
    problems.push(`the direct route needs all of ${directVars.join(", ")} (missing ${directVars.filter((n) => !directSet.includes(n)).join(", ")})`);
  }

  if (choice === "meterless") return { primary: meterless, problems, forcedOffline: false };
  if (choice === "direct") return { primary: direct, problems, forcedOffline: false };
  return meterless ? { primary: meterless, fallback: direct, problems, forcedOffline: false } : { primary: direct, problems, forcedOffline: false };
}

export class ModelClient {
  constructor(readonly route: ModelRoute, private readonly fetchImpl: FetchLike = fetch) {}

  private headers(chat: boolean): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.route.token}` };
    if (this.route.id === "meterless") {
      headers["meterless-app"] = METERLESS_APP_ID;
      if (chat) headers["meterless-scope"] = "user";
    }
    if (chat) headers["Content-Type"] = "application/json";
    return headers;
  }

  async discover(): Promise<{ status: RouteStatus; models: string[]; detail?: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.route.baseUrl}/models`, {
        headers: this.headers(false),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
    } catch (error) {
      return { status: "offline", models: [], detail: `not reachable at ${this.route.baseUrl}: ${errorText(error)}` };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: "unauthorized", models: [], detail: `HTTP ${response.status}` };
    }
    if (!response.ok) return { status: "offline", models: [], detail: `HTTP ${response.status}` };
    const body = (await response.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
    const models = (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    const online = this.route.id === "meterless" ? models.some((id) => id.startsWith("meterless/")) : models.length > 0;
    return { status: online ? "online" : "offline", models, detail: online ? undefined : "no usable model ids in /models" };
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<AssistantMessage> {
    const body: Record<string, unknown> = { model: this.route.model, messages };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.route.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      const where = this.route.id === "meterless"
        ? `Meterless Runtime isn't reachable at ${this.route.baseUrl}. Start Nightshift, or run provider-check to auto-detect it.`
        : `The model route isn't reachable at ${this.route.baseUrl}.`;
      throw new ProviderError(`${where} (${errorText(error)})`, this.route.id, true);
    }
    const text = await response.text();
    if (!response.ok) throw httpError(this.route, response.status, text);

    const parsed = safeJson(text) as { choices?: { message?: AssistantMessage }[] } | undefined;
    const message = parsed?.choices?.[0]?.message;
    if (!message) throw new ProviderError(`${this.route.id} returned no message: ${text.slice(0, 160)}`, this.route.id, false, response.status);
    return { role: "assistant", content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  }
}

// The model the research agent talks to: the primary route, falling back to
// the secondary one only when the primary can't be reached at all.
export class ResearchModel {
  lastRoute?: ModelRoute;
  readonly fallbackEvents: string[] = [];

  constructor(private readonly primary: ModelClient, private readonly fallback?: ModelClient) {}

  get route(): ModelRoute {
    return this.primary.route;
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<AssistantMessage> {
    try {
      const reply = await this.primary.chat(messages, tools);
      this.lastRoute = this.primary.route;
      return reply;
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.transport || !this.fallback) throw error;
      this.fallbackEvents.push(`${error.message} Fell back to ${this.fallback.route.id} (${this.fallback.route.model}).`);
      const reply = await this.fallback.chat(messages, tools);
      this.lastRoute = this.fallback.route;
      return reply;
    }
  }
}

export function createResearchModel(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch): ResearchModel | undefined {
  const { primary, fallback } = resolveRoutes(env);
  if (!primary) return undefined;
  return new ResearchModel(new ModelClient(primary, fetchImpl), fallback && new ModelClient(fallback, fetchImpl));
}

// Tries the contract's ports and hosts; returns the first runtime that answers
// online or unauthorized.
export async function autoDetectMeterless(token: string, fetchImpl: FetchLike = fetch): Promise<{ baseUrl: string; status: RouteStatus } | undefined> {
  for (const host of AUTO_DETECT_HOSTS) {
    for (const port of AUTO_DETECT_PORTS) {
      const baseUrl = `http://${host}:${port}/v1`;
      const client = new ModelClient({ id: "meterless", baseUrl, token: token || "missing", model: "meterless/auto" }, (input, init) =>
        fetchImpl(input, { ...init, signal: AbortSignal.timeout(1500) }),
      );
      const { status } = await client.discover();
      if (status !== "offline") return { baseUrl, status };
    }
  }
  return undefined;
}

function httpError(route: ModelRoute, status: number, text: string): ProviderError {
  const body = safeJson(text) as { error?: { message?: string; code?: string }; meterless?: { fix?: unknown } } | undefined;
  const fix = Array.isArray(body?.meterless?.fix) ? body!.meterless!.fix.filter((f): f is string => typeof f === "string") : undefined;
  const parts = [body?.error?.message ?? `HTTP ${status}: ${text.slice(0, 160)}`];
  // The server's fix wins; our own hint only fills the gap.
  if (fix && fix.length > 0) {
    parts.push(`Fix: ${fix.join("; ")}`);
  } else if (status === 401 || status === 403) {
    parts.push(route.id === "meterless"
      ? "Paste the runtime's access token from the Nightshift Console into METERLESS_RUNTIME_TOKEN."
      : "Check that MODEL_API_KEY belongs to the same route as MODEL_BASE_URL.");
  } else if (status === 404) {
    parts.push(`Check that model "${route.model}" exists on this route (run provider-check to list models).`);
  } else if (status === 429) {
    parts.push("Rate or credit limit reached; wait and retry, or switch routes.");
  }
  return new ProviderError(parts.join(" "), route.id, false, status, body?.error?.code, fix);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return cause ? `${error.message}: ${cause}` : error.message;
  }
  return String(error);
}
