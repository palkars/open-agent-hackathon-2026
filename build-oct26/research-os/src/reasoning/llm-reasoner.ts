import type { EvidenceAssessment, ResearchConclusion, ResearchContext } from "../agents/types.ts";
import { formatResearchContext } from "./context-formatter.ts";
import type { ResearchReasoner } from "./types.ts";

const ASSESSMENTS = ["SUPPORTED", "CONTRADICTED", "MIXED", "INSUFFICIENT"] as const;
const SOURCE_ID_TOKEN = /\b[A-Z]{1,3}\d{2,}\b/g;
const DEFAULT_BASE_URL = "http://127.0.0.1:8088/v1";
const DEFAULT_MODEL = "meterless/auto";
const APP_ID = "research-os";
const REQUEST_TIMEOUT_MS = 180_000;
const DETECT_PORTS = [8088, 8090, 8787, 11434];

const SYSTEM_INSTRUCTION = `You are the reasoning component of ResearchOS.
You may reason ONLY from the supplied prior research memory and current research evidence.
Do not introduce facts that are not contained in the supplied context.
Do not invent papers, citations, experiments, measurements, or source IDs.
Every source ID you return must appear in the supplied context.
If the evidence is insufficient, set assessment to INSUFFICIENT.
If the evidence conflicts, represent that uncertainty. Do not force a conclusion the evidence does not support.
Return only the structured conclusion. assessment must be SUPPORTED, CONTRADICTED, MIXED, or INSUFFICIENT.
confidence must be a number from 0 to 1.`;

const CONCLUSION_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  required: [
    "assessment",
    "summary",
    "confidence",
    "supportingSourceIds",
    "conflictingSourceIds",
    "openQuestions",
  ],
  properties: {
    assessment: { type: "string", enum: [...ASSESSMENTS] },
    summary: { type: "string" },
    confidence: { type: "number" },
    supportingSourceIds: { type: "array", items: { type: "string" } },
    conflictingSourceIds: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
  },
};

export class LLMResearchReasoner implements ResearchReasoner {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async assess(context: ResearchContext): Promise<ResearchConclusion> {
    const content = await this.complete(formatResearchContext(context));
    return parseConclusion(content, sourceIdsIn(context));
  }

  private async complete(prompt: string): Promise<string> {
    const provider = (this.env.LLM_PROVIDER ?? "meterless").trim().toLowerCase();
    if (provider !== "meterless") throw new Error("LLM_PROVIDER must be meterless.");
    const token = runtimeToken(this.env);
    const baseUrl = await resolveBaseUrl(this.env);
    const model = selectModel(await listRuntimeModels(baseUrl, token), this.env);
    const appId = this.env.METERLESS_APP?.trim() || APP_ID;

    const body = {
      model,
      temperature: 0,
      max_tokens: 800,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: prompt },
      ],
    };
    console.log(`[Meterless] Reasoning with ${model}`);
    let completion = await postCompletion(baseUrl, token, appId, {
      ...body,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "research_conclusion",
          strict: true,
          schema: CONCLUSION_SCHEMA,
        },
      },
    });
    if (completion.status === 400 || completion.status === 422 || completion.status === 504) {
      completion = await postCompletion(baseUrl, token, appId, body);
    }
    if (completion.status === 401 || completion.status === 403) throw new Error("LLM request unauthorized.");
    if (!completion.ok) throw new Error(`LLM request failed: HTTP ${completion.status}`);

    const content = messageText(completion.payload);
    const answeredBy = typeof completion.payload.model === "string" ? completion.payload.model : model;
    console.log(`[Meterless] Answered by ${answeredBy}`);
    if (!content.trim()) throw new Error("LLM conclusion was not valid JSON.");
    return content;
  }
}

interface CompletionResult {
  status: number;
  ok: boolean;
  payload: Record<string, unknown>;
}

function runtimeToken(env: NodeJS.ProcessEnv): string {
  const token = env.METERLESS_RUNTIME_TOKEN?.trim() ?? "";
  if (!token) throw new Error("Set METERLESS_RUNTIME_TOKEN.");
  if (token === "rt-local") throw new Error("METERLESS_RUNTIME_TOKEN is invalid.");
  return token;
}

function normalizeBaseUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, "");
  value = value.replace(/\/v1\/chat\/completions$/i, "");
  value = value.replace(/\/v1\/models$/i, "");
  value = value.replace(/\/healthz$/i, "");
  value = value.replace(/\/v1$/i, "");
  value = value.replace(/\/+$/, "");
  return `${value}/v1`;
}

function originOf(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

async function resolveBaseUrl(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = normalizeBaseUrl(env.METERLESS_BASE_URL?.trim() || DEFAULT_BASE_URL);
  if (await runtimeResponds(configured)) return configured;
  const host = new URL(configured).hostname;
  for (const port of DETECT_PORTS) {
    const candidate = normalizeBaseUrl(`http://${host}:${port}/v1`);
    if (candidate !== configured && (await runtimeResponds(candidate))) return candidate;
  }
  return configured;
}

async function runtimeResponds(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${originOf(baseUrl)}/healthz`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function listRuntimeModels(baseUrl: string, token: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: meterlessHeaders(token),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Meterless runtime is offline.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("LLM request unauthorized.");
  if (!response.ok) throw new Error("Meterless runtime is offline.");
  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const data = isRecord(payload) ? payload.data : undefined;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []));
}

function selectModel(ids: string[], env: NodeJS.ProcessEnv): string {
  const requested = env.METERLESS_MODEL?.trim() ?? "";
  if (requested && requested !== DEFAULT_MODEL) return requested;
  const preferred = "nvidia/nemotron-3.5-lightning-30b-a3b";
  if (ids.includes(preferred)) return preferred;
  const nemotron = ids.find((id) => id.startsWith("nvidia/nemotron"));
  return nemotron ?? (requested || DEFAULT_MODEL);
}

function meterlessHeaders(token: string, appId = APP_ID): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("meterless-app", appId);
  headers.set("meterless-scope", "user");
  return headers;
}

async function postCompletion(
  baseUrl: string,
  token: string,
  appId: string,
  body: { [key: string]: unknown },
): Promise<CompletionResult> {
  let response: Response;
  try {
    const headers = meterlessHeaders(token, appId);
    headers.set("Content-Type", "application/json");
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("LLM request failed: timeout");
    throw new Error("Meterless runtime is offline.");
  }
  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { status: response.status, ok: response.ok, payload: isRecord(payload) ? payload : {} };
}

function messageText(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) return "";
  const message = choices[0].message;
  if (!isRecord(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function parseConclusion(raw: string, allowed: Set<string>): ResearchConclusion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("LLM conclusion was not valid JSON.");
  }
  if (!isRecord(parsed)) throw new Error("LLM conclusion was not valid JSON.");

  const assessment = parsed.assessment;
  if (!isAssessment(assessment)) throw new Error("LLM conclusion assessment is invalid.");
  if (typeof parsed.summary !== "string" || parsed.summary.trim() === "") {
    throw new Error("LLM conclusion summary is invalid.");
  }
  if (!isConfidence(parsed.confidence)) throw new Error("LLM conclusion confidence is invalid.");

  const summary = parsed.summary.trim();
  const supportingSourceIds = sourceIdList(parsed.supportingSourceIds, allowed);
  const conflictingSourceIds = sourceIdList(parsed.conflictingSourceIds, allowed);
  const openQuestions = stringList(parsed.openQuestions);
  assertKnownSourceIds(summary, allowed);
  for (const question of openQuestions) assertKnownSourceIds(question, allowed);

  return {
    assessment,
    summary,
    confidence: parsed.confidence,
    supportingSourceIds,
    conflictingSourceIds,
    openQuestions,
  };
}

function sourceIdsIn(context: ResearchContext): Set<string> {
  const ids = new Set<string>();
  for (const hit of context.priorMemories.memories) {
    const record = hit.memory;
    for (const ref of record.provenance?.refs ?? []) addId(ids, ref);
    for (const part of (record.source ?? "").split(",")) addId(ids, part);
  }
  const evidence = context.currentEvidence;
  if (Array.isArray(evidence)) {
    for (const row of evidence) addId(ids, row.paper_id);
  } else {
    for (const paper of evidence.papers) addId(ids, paper.paper_id);
    for (const note of evidence.notes) addId(ids, note.paper_id);
    for (const experiment of evidence.experiments) addId(ids, experiment.paper_id);
  }
  return ids;
}

function sourceIdList(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) throw new Error("LLM conclusion source IDs are invalid.");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new Error("LLM conclusion source IDs are invalid.");
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    if (!allowed.has(id)) throw new Error("LLM conclusion contains an unknown source ID.");
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("LLM conclusion open questions are invalid.");
  const questions: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("LLM conclusion open questions are invalid.");
    const question = item.trim();
    if (question) questions.push(question);
  }
  return questions;
}

function assertKnownSourceIds(value: string, allowed: Set<string>): void {
  for (const token of value.match(SOURCE_ID_TOKEN) ?? []) {
    if (!allowed.has(token)) throw new Error("LLM conclusion contains an unknown source ID.");
  }
}

function addId(ids: Set<string>, value: string | undefined): void {
  const id = value?.trim();
  if (id) ids.add(id);
}

function isAssessment(value: unknown): value is EvidenceAssessment {
  return typeof value === "string" && (ASSESSMENTS as readonly string[]).includes(value);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}
