import { performance } from "node:perf_hooks";
import type { ResearchMemory, ResearchMemoryInput, ResearchMemoryType } from "../memory/research-memory.ts";
import type { ResearchReasoner } from "../reasoning/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme, ZetarisResearchRepository } from "../zetaris/repository.ts";
import { ZetarisClientError } from "../zetaris/types.ts";
import type { ResearchEvidence } from "../data/types.ts";
import type { EvidenceAssessment, ResearchAgentResult, ResearchConclusion, ResearchContext, ResearchTimings } from "./types.ts";

const MEMORY_RETRIEVAL_ERROR = "MEMORY_RETRIEVAL_ERROR";
const ZETARIS_AUTHENTICATION_ERROR = "ZETARIS_AUTHENTICATION_ERROR";
const ZETARIS_CONNECTION_ERROR = "ZETARIS_CONNECTION_ERROR";
const REASONING_ERROR = "REASONING_ERROR";

const CONCLUSION_MEMORY_TYPE: Record<EvidenceAssessment, ResearchMemoryType> = {
  SUPPORTED: "CLAIM",
  CONTRADICTED: "CONTRADICTION",
  MIXED: "LIMITATION",
  INSUFFICIENT: "OPEN_QUESTION",
};

const CONCLUSION_TAGS = [
  "researchos",
  "agent-generated",
  "post-quantum",
  "anonymity",
  "traceability",
  "trusted-opener",
] as const;

export class ResearchAgent {
  private phaseMs: Omit<ResearchTimings, "totalMs"> = {
    memoryRetrievalMs: 0,
    zetarisRetrievalMs: 0,
    reasoningMs: 0,
    memoryStoreMs: 0,
  };

  constructor(
    private readonly memory: ResearchMemory,
    private readonly repository: ZetarisResearchRepository,
    private readonly reasoner: ResearchReasoner,
  ) {}

  async research(question: string): Promise<ResearchAgentResult> {
    const text = question.trim();
    if (!text) {
      throw new Error("Research question cannot be empty");
    }

    const started = performance.now();
    console.log("[ResearchOS] Question received");
    const context = await this.gatherResearchContext(text);
    console.log("[ResearchOS] Assessing evidence");
    const conclusion = await this.assessResearchContext(context);
    const stored = this.storeResearchConclusion(conclusion);
    if (stored.memoryStored) console.log("[Meterless H-MEM] Storing new research learning");
    else if (stored.storedMemoryId) console.log("[Meterless H-MEM] Research learning already stored");
    console.log("[ResearchOS] Complete");

    return {
      question: context.question,
      context,
      conclusion,
      memoryStored: stored.memoryStored,
      ...(stored.storedMemoryId ? { storedMemoryId: stored.storedMemoryId } : {}),
      timings: { ...this.phaseMs, totalMs: elapsedMs(started) },
    };
  }

  async gatherResearchContext(question: string): Promise<ResearchContext> {
    const text = question.trim();
    if (!text) {
      throw new Error("Research question cannot be empty");
    }

    console.log("[Meterless H-MEM] Retrieving prior knowledge");
    let priorMemories: ResearchContext["priorMemories"];
    const memoryStarted = performance.now();
    try {
      priorMemories = this.memory.retrieveResearchMemory(text);
    } catch {
      throw new Error(MEMORY_RETRIEVAL_ERROR);
    } finally {
      this.phaseMs.memoryRetrievalMs = elapsedMs(memoryStarted);
    }

    console.log("[Zetaris] Retrieving current evidence");
    let currentEvidence: ResearchContext["currentEvidence"];
    const zetarisStarted = performance.now();
    try {
      currentEvidence = await this.repository.findPostQuantumAnonymousTraceableSchemes();
    } catch (error) {
      throw reportedZetarisError(error);
    } finally {
      this.phaseMs.zetarisRetrievalMs = elapsedMs(zetarisStarted);
    }

    return {
      question: { question: text },
      priorMemories,
      currentEvidence,
    };
  }

  async assessResearchContext(context: ResearchContext): Promise<ResearchConclusion> {
    const started = performance.now();
    try {
      return await this.reasoner.assess(context);
    } catch {
      if (!hasCurrentEvidence(context.currentEvidence)) return insufficientConclusion();
      throw new Error(REASONING_ERROR);
    } finally {
      this.phaseMs.reasoningMs = elapsedMs(started);
    }
  }

  storeResearchConclusion(conclusion: ResearchConclusion): Pick<ResearchAgentResult, "memoryStored" | "storedMemoryId"> {
    const started = performance.now();
    try {
      return this.writeResearchConclusion(conclusion);
    } catch {
      return { memoryStored: false };
    } finally {
      this.phaseMs.memoryStoreMs = elapsedMs(started);
    }
  }

  private writeResearchConclusion(conclusion: ResearchConclusion): Pick<ResearchAgentResult, "memoryStored" | "storedMemoryId"> {
    const finding: ResearchMemoryInput = {
      type: CONCLUSION_MEMORY_TYPE[conclusion.assessment],
      content: conclusion.summary,
      confidence: conclusion.confidence,
      sourceIds: sourceIds(conclusion),
      tags: [...CONCLUSION_TAGS],
    };

    const existing = this.memory.findResearchFinding(finding);
    if (existing) return { memoryStored: false, storedMemoryId: existing.id };

    const stored = this.memory.rememberResearchFinding(finding);
    const storedMemoryId = typeof stored.id === "string" ? stored.id.trim() : "";
    return storedMemoryId ? { memoryStored: true, storedMemoryId } : { memoryStored: true };
  }
}

function elapsedMs(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function reportedZetarisError(error: unknown): Error {
  if (error instanceof ZetarisClientError) {
    if (error.kind === "auth") return new Error(ZETARIS_AUTHENTICATION_ERROR);
    if (error.kind === "config" && /password|api[_ ]?key|username|credential|unauthor|forbidden/i.test(error.message)) {
      return new Error(ZETARIS_AUTHENTICATION_ERROR);
    }
  }
  return new Error(ZETARIS_CONNECTION_ERROR);
}

function hasCurrentEvidence(evidence: ResearchEvidence | TraceableScheme[] | PotentiallyConflictingEvidence[]): boolean {
  if (Array.isArray(evidence)) return evidence.length > 0;
  return evidence.papers.length > 0 || evidence.notes.length > 0 || evidence.experiments.length > 0;
}

function insufficientConclusion(): ResearchConclusion {
  return {
    assessment: "INSUFFICIENT",
    summary: "No relevant Zetaris evidence was returned for this question.",
    confidence: 0,
    supportingSourceIds: [],
    conflictingSourceIds: [],
    openQuestions: [],
  };
}

function sourceIds(conclusion: ResearchConclusion): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [...conclusion.supportingSourceIds, ...conclusion.conflictingSourceIds]) {
    const text = id.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    ids.push(text);
  }
  return ids;
}
