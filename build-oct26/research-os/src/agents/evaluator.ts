import type { ResearchEvidence } from "../data/types.ts";
import { formatResearchContext } from "../reasoning/context-formatter.ts";
import { completeMeterless } from "../reasoning/llm-reasoner.ts";
import type { ResearchReasoner } from "../reasoning/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme } from "../zetaris/repository.ts";
import type { ContradictionReport, EvidenceRelationship, ResearchConclusion, ResearchContext } from "./types.ts";

const RELATIONSHIPS = ["SUPPORTS", "CONTRADICTS", "EXTENDS", "UNRELATED"] as const;

const RECOMMENDATION: Record<EvidenceRelationship, string> = {
  CONTRADICTS: "Revise existing conclusion.",
  SUPPORTS: "Keep the existing conclusion.",
  EXTENDS: "Add the new evidence to the existing conclusion.",
  UNRELATED: "Leave the existing conclusion unchanged.",
};

const EVALUATION_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  required: ["reports"],
  properties: {
    reports: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["relationship", "memoryId", "evidence", "confidence", "reason", "recommendation"],
        properties: {
          relationship: { type: "string", enum: [...RELATIONSHIPS] },
          memoryId: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          reason: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTION = `You compare each prior research memory with the current Zetaris evidence.
Use only the supplied memory ids and source ids.
relationship must be SUPPORTS, CONTRADICTS, EXTENDS, or UNRELATED.
CONTRADICTS means the evidence conflicts with that memory. Its recommendation must be "Revise existing conclusion."
SUPPORTS means the evidence agrees with that memory.
EXTENDS means the evidence adds source ids or findings the memory does not already cite.
UNRELATED means the evidence does not bear on that memory.
confidence is a number from 0 to 1.
Return one report for every supplied memory id. Return only JSON.`;

export class ContradictionEvaluator {
  constructor(
    private readonly reasoner: ResearchReasoner,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async evaluate(context: ResearchContext, conclusion: ResearchConclusion): Promise<ContradictionReport[]> {
    const memories = context.priorMemories.memories;
    if (memories.length === 0) return [];
    if (!isLlmReasoner(this.reasoner)) return deterministicEvaluations(context);
    const raw = await completeMeterless(this.env, {
      system: SYSTEM_INSTRUCTION,
      user: evaluationPrompt(context, conclusion),
      schemaName: "contradiction_reports",
      schema: EVALUATION_SCHEMA,
      activity: "Evaluating contradictions",
    });
    try {
      return parseReports(raw, context);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "LLM evaluation was not valid JSON.";
      console.error(`[ResearchOS] ${detail}`);
      return deterministicEvaluations(context);
    }
  }
}

function isLlmReasoner(reasoner: ResearchReasoner): boolean {
  return reasoner.constructor.name === "LLMResearchReasoner";
}

function evaluationPrompt(context: ResearchContext, conclusion: ResearchConclusion): string {
  const memories = context.priorMemories.memories.map((hit) => `${hit.memory.id}: ${hit.memory.content}`);
  return [
    formatResearchContext(context),
    "",
    "MEMORY IDS",
    memories.join("\n"),
    "",
    "CONCLUSION",
    conclusion.assessment,
    conclusion.summary,
    `supporting: ${conclusion.supportingSourceIds.join(", ") || "none"}`,
    `conflicting: ${conclusion.conflictingSourceIds.join(", ") || "none"}`,
    "",
    `Return one report for each memory id: ${memories.map((line) => line.split(":")[0]).join(", ")}`,
  ].join("\n");
}

function parseReports(raw: string, context: ResearchContext): ContradictionReport[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("LLM evaluation was not valid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.reports)) throw new Error("LLM evaluation was not valid JSON.");

  const memories = new Map(context.priorMemories.memories.map((hit) => [hit.memory.id, hit.memory]));
  const allowed = sourceIdsIn(context);
  const seen = new Set<string>();
  const reports: ContradictionReport[] = [];

  for (const item of parsed.reports) {
    if (!isRecord(item)) continue;
    const relationship = item.relationship;
    if (!isRelationship(relationship)) continue;
    if (typeof item.memoryId !== "string" || !memories.has(item.memoryId) || seen.has(item.memoryId)) continue;
    const confidenceValue = readConfidence(item.confidence);
    if (confidenceValue === undefined) continue;
    if (typeof item.reason !== "string" || item.reason.trim() === "") continue;
    const evidence = sourceIdList(item.evidence, allowed);
    if (relationship !== "UNRELATED" && evidence.length === 0) continue;
    seen.add(item.memoryId);
    const recommendation = relationship === "CONTRADICTS"
      ? RECOMMENDATION.CONTRADICTS
      : typeof item.recommendation === "string" && item.recommendation.trim()
        ? item.recommendation.trim()
        : RECOMMENDATION[relationship];
    reports.push({
      relationship,
      memoryId: item.memoryId,
      evidence,
      confidence: confidenceValue,
      reason: item.reason.trim(),
      recommendation,
    });
  }

  for (const hit of context.priorMemories.memories) {
    if (!seen.has(hit.memory.id)) reports.push(deterministicReport(hit.memory, context));
  }
  return reports;
}

export function deterministicEvaluations(context: ResearchContext): ContradictionReport[] {
  return context.priorMemories.memories.map((hit) => deterministicReport(hit.memory, context));
}

function deterministicReport(memory: ResearchContext["priorMemories"]["memories"][number]["memory"], context: ResearchContext): ContradictionReport {
  const facts = evidenceFacts(context.currentEvidence);
  const memoryIds = sourceIdsOf(memory.source, memory.provenance?.refs);
  const contradicting = facts.filter((fact) => fact.noTrustedOpener || fact.skeptical);
  if (claimsTrustedOpenerRequired(memory.content) && contradicting.length > 0) {
    return report("CONTRADICTS", memory.id, unique(contradicting.map((fact) => fact.paperId)), confidence(memory.confidence, 0.8), `${unique(contradicting.map((fact) => fact.paperId)).join(", ")} record traceability without a trusted opener, which conflicts with this memory.`);
  }

  const overlap = facts.filter((fact) => memoryIds.has(fact.paperId));
  if (overlap.length === 0) {
    return report("UNRELATED", memory.id, [], confidence(memory.confidence, 0.4), "The current Zetaris evidence does not cite the same sources as this memory.");
  }
  const novel = facts.filter((fact) => !memoryIds.has(fact.paperId));
  if (novel.length > 0) {
    return report("EXTENDS", memory.id, unique([...overlap, ...novel].map((fact) => fact.paperId)), confidence(memory.confidence, 0.65), `${unique(novel.map((fact) => fact.paperId)).join(", ")} add evidence beyond the sources already cited by this memory.`);
  }
  return report("SUPPORTS", memory.id, unique(overlap.map((fact) => fact.paperId)), confidence(memory.confidence, 0.7), `${unique(overlap.map((fact) => fact.paperId)).join(", ")} agree with the sources already cited by this memory.`);
}

function report(relationship: EvidenceRelationship, memoryId: string, evidence: string[], confidenceValue: number, reason: string): ContradictionReport {
  return {
    relationship,
    memoryId,
    evidence,
    confidence: confidenceValue,
    reason,
    recommendation: RECOMMENDATION[relationship],
  };
}

interface EvidenceFact {
  paperId: string;
  noTrustedOpener: boolean;
  skeptical: boolean;
}

function evidenceFacts(evidence: ResearchContext["currentEvidence"]): EvidenceFact[] {
  if (Array.isArray(evidence)) {
    return evidence.flatMap((row) => ("researcher_note" in row ? [conflictFact(row)] : [schemeFact(row)]));
  }
  return researchFacts(evidence);
}

function schemeFact(scheme: TraceableScheme): EvidenceFact {
  return { paperId: scheme.paper_id, noTrustedOpener: scheme.trusted_opener_required === false, skeptical: false };
}

function conflictFact(row: PotentiallyConflictingEvidence): EvidenceFact {
  return {
    paperId: row.paper_id,
    noTrustedOpener: row.trusted_opener_required === false,
    skeptical: row.note_stance.trim().toUpperCase() === "SKEPTICAL",
  };
}

function researchFacts(evidence: ResearchEvidence): EvidenceFact[] {
  const skepticalPapers = new Set(
    evidence.notes.filter((note) => note.paper_id && note.type?.trim().toUpperCase() === "SKEPTICAL").map((note) => note.paper_id as string),
  );
  return evidence.papers
    .filter((paper) => paper.paper_id.trim())
    .map((paper) => ({
      paperId: paper.paper_id,
      noTrustedOpener: paper.trusted_opener_required === false,
      skeptical: skepticalPapers.has(paper.paper_id),
    }));
}

function claimsTrustedOpenerRequired(content: string): boolean {
  const text = content.toLowerCase();
  if (text.includes("separates") || text.includes("without a single") || text.includes("without one")) return false;
  return /requir\w*\s+(?:a\s+|a single\s+)?trusted open/.test(text) || text.includes("dependence on a trusted opener");
}

function sourceIdsOf(source: string | undefined, refs: string[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const ref of refs ?? []) addId(ids, ref);
  for (const part of (source ?? "").split(",")) addId(ids, part);
  return ids;
}

function sourceIdsIn(context: ResearchContext): Set<string> {
  const ids = new Set<string>();
  for (const hit of context.priorMemories.memories) {
    for (const id of sourceIdsOf(hit.memory.source, hit.memory.provenance?.refs)) ids.add(id);
  }
  for (const fact of evidenceFacts(context.currentEvidence)) addId(ids, fact.paperId);
  return ids;
}

function sourceIdList(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id) || !allowed.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function readConfidence(value: unknown): number | undefined {
  let numeric: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) numeric = value;
  if (typeof value === "string") {
    const percent = value.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
    const parsed = percent ? Number(percent[1]) : Number(value.trim());
    if (Number.isFinite(parsed)) numeric = percent ? parsed / 100 : parsed;
  }
  if (numeric === undefined) return undefined;
  const scaled = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return scaled >= 0 && scaled <= 1 ? scaled : undefined;
}

function confidence(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function addId(ids: Set<string>, value: string | undefined): void {
  const id = value?.trim();
  if (id) ids.add(id);
}

function isRelationship(value: unknown): value is EvidenceRelationship {
  return typeof value === "string" && (RELATIONSHIPS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}
