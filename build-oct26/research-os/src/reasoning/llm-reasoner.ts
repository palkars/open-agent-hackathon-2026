import OpenAI from "openai";
import type { EvidenceAssessment, ResearchConclusion, ResearchContext } from "../agents/types.ts";
import { formatResearchContext } from "./context-formatter.ts";
import type { ResearchReasoner } from "./types.ts";

const ASSESSMENTS = ["SUPPORTED", "CONTRADICTED", "MIXED", "INSUFFICIENT"] as const;
const SOURCE_ID_TOKEN = /\b[A-Z]{1,3}\d{2,}\b/g;
const DEFAULT_MODEL = "gpt-4.1";

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
    const provider = (this.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
    if (provider !== "openai") throw new Error("LLM_PROVIDER must be openai.");
    const apiKey = this.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("Set OPENAI_API_KEY.");

    const client = new OpenAI({ apiKey });
    try {
      const completion = await client.chat.completions.create({
        model: this.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
        temperature: 0,
        store: false,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "research_conclusion",
            strict: true,
            schema: CONCLUSION_SCHEMA,
          },
        },
      });
      const content = completion.choices[0]?.message?.content;
      if (!content?.trim()) throw new Error("LLM conclusion was not valid JSON.");
      return content;
    } catch (error) {
      if (error instanceof Error && /LLM /.test(error.message)) throw error;
      if (error instanceof OpenAI.APIError && typeof error.status === "number") {
        throw new Error(`LLM request failed: HTTP ${error.status}`);
      }
      throw new Error("LLM request failed.");
    }
  }
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
