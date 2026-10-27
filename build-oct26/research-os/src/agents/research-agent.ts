import { performance } from "node:perf_hooks";
import type { ResearchMemory, ResearchMemoryInput, ResearchMemoryType } from "../memory/research-memory.ts";
import type { ResearchReasoner } from "../reasoning/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme, ZetarisResearchRepository } from "../zetaris/repository.ts";
import { ZetarisClientError } from "../zetaris/types.ts";
import type { Experiment, Paper, ResearchEvidence, ResearchNote } from "../data/types.ts";
import { Markovian, resetRunSeq } from "../../vendor/markovian/src/index.ts";
import { ContradictionEvaluator } from "./evaluator.ts";
import type { ContradictionReport, EvidenceAssessment, MarkovianTrace, ResearchAgentResult, ResearchConclusion, ResearchContext, ResearchTimings, ResearchTraceEntry } from "./types.ts";
import { MAX_RESEARCH_ITERATIONS } from "./types.ts";

const MEMORY_RETRIEVAL_ERROR = "MEMORY_RETRIEVAL_ERROR";
const ZETARIS_AUTHENTICATION_ERROR = "ZETARIS_AUTHENTICATION_ERROR";
const ZETARIS_CONNECTION_ERROR = "ZETARIS_CONNECTION_ERROR";
const REASONING_ERROR = "REASONING_ERROR";
const EVALUATION_ERROR = "EVALUATION_ERROR";

const CONCLUSION_MEMORY_TYPE: Record<EvidenceAssessment, ResearchMemoryType> = {
  SUPPORTED: "CLAIM",
  CONTRADICTED: "CONTRADICTION",
  MIXED: "LIMITATION",
  INSUFFICIENT: "OPEN_QUESTION",
};

const PAPER_ID = /\b[A-Z]{1,3}\d{2,}\b/g;
const CONFLICT_FOCUS = /\b(conflict\w*|contradict\w*|skeptic\w*)\b/i;
const MARKOVIAN_CONFIG = { chunkSize: 2000, maxChunks: MAX_RESEARCH_ITERATIONS, carryoverTokens: 128 };

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
    evaluationMs: 0,
    memoryStoreMs: 0,
  };

  constructor(
    private readonly memory: ResearchMemory,
    private readonly repository: ZetarisResearchRepository,
    private readonly reasoner: ResearchReasoner,
    private readonly evaluator: ContradictionEvaluator = new ContradictionEvaluator(reasoner),
  ) {}

  async research(question: string): Promise<ResearchAgentResult> {
    const text = question.trim();
    if (!text) {
      throw new Error("Research question cannot be empty");
    }

    const started = performance.now();
    this.resetPhases();
    console.log("[ResearchOS] Question received");
    const investigation = await this.investigate(text, true);
    console.log("[ResearchOS] Evaluating contradictions");
    const evaluations = await this.evaluateContradictions(investigation.context, investigation.conclusion);
    const stored = this.storeResearchConclusion(investigation.conclusion);
    if (stored.memoryStored) console.log("[Meterless H-MEM] Storing new research learning");
    else if (stored.storedMemoryId) console.log("[Meterless H-MEM] Research learning already stored");
    console.log("[ResearchOS] Complete");

    return {
      question: investigation.context.question,
      context: investigation.context,
      conclusion: investigation.conclusion,
      evaluations,
      iterations: investigation.iterations,
      trace: investigation.trace,
      markovian: investigation.markovian,
      memoryStored: stored.memoryStored,
      ...(stored.storedMemoryId ? { storedMemoryId: stored.storedMemoryId } : {}),
      timings: { ...this.phaseMs, totalMs: elapsedMs(started) },
    };
  }

  async compareResearch(question: string): Promise<{ cold: MarkovianTrace; warm: MarkovianTrace }> {
    const text = question.trim();
    if (!text) throw new Error("Research question cannot be empty");
    this.resetPhases();
    console.log("[ResearchOS] Cold run");
    const cold = await this.investigate(text, false);
    this.resetPhases();
    console.log("[ResearchOS] Warm run");
    const warm = await this.investigate(text, true);
    return { cold: cold.markovian, warm: warm.markovian };
  }

  private resetPhases(): void {
    this.phaseMs = {
      memoryRetrievalMs: 0,
      zetarisRetrievalMs: 0,
      reasoningMs: 0,
      evaluationMs: 0,
      memoryStoreMs: 0,
    };
  }

  private async investigate(question: string, warm: boolean): Promise<Pick<ResearchAgentResult, "context" | "conclusion" | "iterations" | "trace" | "markovian">> {
    const trace: ResearchTraceEntry[] = [];
    const resolved: string[] = [];
    let evidence = emptyEvidence();
    let priorMemories = emptyRecall();
    let conclusion = insufficientConclusion();
    const label = warm ? "Warm" : "Cold";

    let memoryContext: string | undefined;
    let warmRecall = emptyRecall();
    if (warm) {
      console.log("[Meterless H-MEM] Retrieving prior knowledge");
      warmRecall = this.recall(question);
      const reinjection = warmRecall.context.trim();
      if (reinjection) memoryContext = reinjection;
    }

    resetRunSeq();
    const markovian = new Markovian({ chunkConfig: MARKOVIAN_CONFIG });
    const run = await markovian.run({
      goal: question,
      mode: "RESEARCH",
      memoryContext,
      reflect: false,
      stepFn: async ({ step, prompt, carryover }) => {
        const iteration = step + 1;
        console.log(`[ResearchOS] ${label} chunk ${iteration} of ${MAX_RESEARCH_ITERATIONS}`);
        const open = parseRemaining(carryover);
        const investigated = parseCompleted(carryover);
        const focus = open.length > 0 ? open.join("\n") : question;
        const memoryResolved = prompt.includes("[MEMORY CONTEXT]");
        if (memoryResolved) {
          trace.push({ iteration, step: "Search memory", detail: "already resolved" });
          if (!resolved.includes("Search memory")) resolved.push("Search memory");
          console.log("[Meterless H-MEM] Search already resolved from reinjection");
          priorMemories = mergeMemories(priorMemories, warmRecall);
        } else {
          trace.push({ iteration, step: "Search memory", detail: oneLine(focus) });
          console.log("[Meterless H-MEM] Retrieving prior knowledge");
          priorMemories = mergeMemories(priorMemories, this.recall(focus));
        }

        const query = nextQuery(focus, open, investigated);
        if (!query) {
          trace.push({ iteration, step: "Conclusion", detail: "No further Zetaris query" });
          return { content: chunkText(trace, iteration) + "\n" + checkpoint(investigated, [], conclusion, true) };
        }

        trace.push({ iteration, step: "Query Zetaris", detail: query.detail });
        console.log("[Zetaris] Retrieving current evidence");
        const batch = await this.retrieveEvidence(query);
        if (query.kind === "paper") investigated.papers.add(query.paperId);
        if (query.kind === "schemes") investigated.schemes = true;
        if (query.kind === "conflicts") investigated.conflicts = true;
        evidence = mergeEvidence(evidence, batch);

        const conflict = batchHasConflict(query.kind, batch);
        trace.push({ iteration, step: conflict ? "Found conflict" : "No conflict", detail: query.detail });
        trace.push({ iteration, step: "Investigate", detail: oneLine(focus) });
        console.log("[ResearchOS] Assessing evidence");
        conclusion = await this.assessResearchContext({
          question: { question },
          priorMemories,
          currentEvidence: evidence,
          chunkPrompt: researchView(prompt),
        });
        const remaining = conclusion.openQuestions;
        const enough = conclusion.assessment !== "INSUFFICIENT" && remaining.length === 0;
        const capped = iteration === MAX_RESEARCH_ITERATIONS;
        const nextFocus = remaining.length > 0 ? remaining.join("\n") : question;
        const followUp = nextQuery(nextFocus, remaining, investigated);
        trace.push({
          iteration,
          step: "Conclusion",
          detail: enough ? conclusion.assessment : capped ? `${conclusion.assessment}; stopped at ${MAX_RESEARCH_ITERATIONS}` : `${conclusion.assessment}; ${remaining.length} open`,
        });
        if (!enough && !capped && !followUp) {
          trace.push({ iteration, step: "Conclusion", detail: "No further Zetaris query" });
        }
        const done = enough || capped || !followUp;
        return { content: chunkText(trace, iteration) + "\n" + checkpoint(investigated, remaining, conclusion, done) };
      },
    });
    if (run.status === "errored") throw new Error(run.error || REASONING_ERROR);

    return {
      context: { question: { question }, priorMemories, currentEvidence: evidence },
      conclusion,
      iterations: run.chunks.length,
      trace,
      markovian: { chunks: run.chunks.length, status: run.status, resolved },
    };
  }

  private recall(text: string): ResearchContext["priorMemories"] {
    const started = performance.now();
    try {
      return this.memory.retrieveResearchMemory(text);
    } catch {
      throw new Error(MEMORY_RETRIEVAL_ERROR);
    } finally {
      this.phaseMs.memoryRetrievalMs += elapsedMs(started);
    }
  }

  private async retrieveEvidence(query: EvidenceQuery): Promise<ResearchEvidence> {
    const started = performance.now();
    try {
      if (query.kind === "paper") return await this.repository.getPaperEvidence(query.paperId);
      if (query.kind === "conflicts") return conflictsToEvidence(await this.repository.getPotentiallyConflictingEvidence());
      return schemesToEvidence(await this.repository.findPostQuantumAnonymousTraceableSchemes());
    } catch (error) {
      throw reportedZetarisError(error);
    } finally {
      this.phaseMs.zetarisRetrievalMs += elapsedMs(started);
    }
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
    } catch (error) {
      if (!hasCurrentEvidence(context.currentEvidence)) return insufficientConclusion();
      const detail = error instanceof Error ? error.message : "LLM conclusion was not valid JSON.";
      console.error(`[ResearchOS] ${detail}`);
      throw new Error(REASONING_ERROR);
    } finally {
      this.phaseMs.reasoningMs += elapsedMs(started);
    }
  }

  async evaluateContradictions(context: ResearchContext, conclusion: ResearchConclusion): Promise<ContradictionReport[]> {
    const started = performance.now();
    try {
      return await this.evaluator.evaluate(context, conclusion);
    } catch {
      throw new Error(EVALUATION_ERROR);
    } finally {
      this.phaseMs.evaluationMs = elapsedMs(started);
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

type EvidenceQuery =
  | { kind: "paper"; paperId: string; detail: string }
  | { kind: "conflicts"; detail: string }
  | { kind: "schemes"; detail: string };

interface InvestigatedQueries {
  papers: Set<string>;
  schemes: boolean;
  conflicts: boolean;
}

function researchView(prompt: string): string {
  const marker = prompt.indexOf("\nEnd every non-final chunk with [STATE_CHECKPOINT]");
  return (marker >= 0 ? prompt.slice(0, marker) : prompt).trim();
}

function chunkText(trace: ResearchTraceEntry[], iteration: number): string {
  return trace.filter((entry) => entry.iteration === iteration).map((entry) => (
    entry.detail === "already resolved" ? `already resolved: ${entry.step}` : `${entry.step}: ${entry.detail}`
  )).join("\n");
}

function checkpoint(investigated: InvestigatedQueries, remaining: string[], conclusion: ResearchConclusion, done: boolean): string {
  const completed = formatCompleted(investigated);
  const open = remaining.length > 0 ? remaining.map((question) => oneLine(question)).join(" | ") : "none";
  const block = [
    `COMPLETED: ${completed}`,
    `REMAINING: ${open}`,
    `DECISIONS: ${conclusion.assessment}`,
    `CONTEXT: ${oneLine(conclusion.summary) || "none"}`,
  ].join("\n");
  return done ? `[STATE_CHECKPOINT]\n${block}\n[TASK_COMPLETE]` : `[STATE_CHECKPOINT]\n${block}`;
}

function formatCompleted(investigated: InvestigatedQueries): string {
  const parts: string[] = [];
  if (investigated.schemes) parts.push("schemes");
  if (investigated.conflicts) parts.push("conflicts");
  parts.push(...[...investigated.papers].sort());
  return parts.join("; ") || "none";
}

function parseCompleted(carryover: string): InvestigatedQueries {
  const investigated: InvestigatedQueries = { papers: new Set(), schemes: false, conflicts: false };
  const line = carryField(carryover, "COMPLETED");
  if (!line || line.toLowerCase() === "none") return investigated;
  for (const part of line.split(";")) {
    const token = part.trim();
    if (token === "schemes") investigated.schemes = true;
    else if (token === "conflicts") investigated.conflicts = true;
    else if (/^[A-Z]{1,3}\d{2,}$/.test(token)) investigated.papers.add(token);
  }
  return investigated;
}

function parseRemaining(carryover: string): string[] {
  const line = carryField(carryover, "REMAINING");
  if (!line || line.toLowerCase() === "none") return [];
  return line.split("|").map((part) => part.trim()).filter(Boolean);
}

function carryField(carryover: string, name: string): string {
  const match = carryover.match(new RegExp(`(?:^|\\n)${name}:\\s*([^\\n]*)`));
  return match?.[1]?.trim() ?? "";
}

function nextQuery(
  focus: string,
  remaining: string[],
  investigated: { papers: Set<string>; schemes: boolean; conflicts: boolean },
): EvidenceQuery | null {
  const text = [focus, ...remaining].join("\n");
  const unseenPaper = paperIds(text).find((id) => !investigated.papers.has(id));
  if (unseenPaper && (investigated.schemes || paperIds(focus).length > 0)) {
    return { kind: "paper", paperId: unseenPaper, detail: unseenPaper };
  }
  if (CONFLICT_FOCUS.test(text) && !investigated.conflicts) return { kind: "conflicts", detail: "potentially conflicting evidence" };
  if (!investigated.schemes) return { kind: "schemes", detail: "post-quantum anonymous traceable schemes" };
  if (unseenPaper) return { kind: "paper", paperId: unseenPaper, detail: unseenPaper };
  if (!investigated.conflicts && CONFLICT_FOCUS.test(text)) return { kind: "conflicts", detail: "potentially conflicting evidence" };
  return null;
}

function paperIds(text: string): string[] {
  return [...new Set([...text.matchAll(PAPER_ID)].map((match) => match[0]))];
}

function emptyEvidence(): ResearchEvidence {
  return { papers: [], notes: [], experiments: [] };
}

function emptyRecall(): ResearchContext["priorMemories"] {
  return { memories: [], context: "", trace: { retrievalReason: "", strategy: "minimal", scores: {} } };
}

function mergeMemories(current: ResearchContext["priorMemories"], next: ResearchContext["priorMemories"]): ResearchContext["priorMemories"] {
  const byId = new Map(current.memories.map((hit) => [hit.memory.id, hit]));
  for (const hit of next.memories) {
    const existing = byId.get(hit.memory.id);
    if (!existing || hit.relevance > existing.relevance) byId.set(hit.memory.id, hit);
  }
  return { memories: [...byId.values()], context: next.context || current.context, trace: next.trace };
}

function schemesToEvidence(schemes: TraceableScheme[]): ResearchEvidence {
  const papers: Paper[] = [];
  const experiments: Experiment[] = [];
  const seen = new Set<string>();
  for (const scheme of schemes) {
    if (!seen.has(scheme.paper_id)) {
      seen.add(scheme.paper_id);
      papers.push({
        paper_id: scheme.paper_id,
        title: scheme.title,
        crypto_method: scheme.crypto_method,
        key_claim: scheme.key_claim,
        limitation: scheme.limitation,
        post_quantum: true,
        provides_anonymity: true,
        provides_traceability: true,
        trusted_opener_required: scheme.trusted_opener_required,
      });
    }
    experiments.push({
      experiment_id: `${scheme.paper_id}:${scheme.scheme ?? "experiment"}`,
      paper_id: scheme.paper_id,
      scheme: scheme.scheme ?? "",
      verify_time_ms: scheme.verify_time_ms,
      signature_size_bytes: scheme.signature_size_bytes,
      communication_kb: scheme.communication_kb,
      result: scheme.result,
    });
  }
  return { papers, notes: [], experiments };
}

function conflictsToEvidence(rows: PotentiallyConflictingEvidence[]): ResearchEvidence {
  const papers: Paper[] = [];
  const notes: ResearchNote[] = [];
  const experiments: Experiment[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!seen.has(row.paper_id)) {
      seen.add(row.paper_id);
      papers.push({
        paper_id: row.paper_id,
        title: row.title,
        key_claim: row.key_claim,
        trusted_opener_required: row.trusted_opener_required,
      });
    }
    notes.push({
      note_id: `${row.paper_id}:note:${index}`,
      paper_id: row.paper_id,
      text: row.researcher_note,
      type: row.note_stance,
      confidence: row.note_confidence,
    });
    if (row.experiment_result) {
      experiments.push({
        experiment_id: `${row.paper_id}:experiment:${index}`,
        paper_id: row.paper_id,
        scheme: "",
        result: row.experiment_result,
      });
    }
  });
  return { papers, notes, experiments };
}

function mergeEvidence(base: ResearchEvidence, extra: ResearchEvidence): ResearchEvidence {
  const papers = new Map(base.papers.map((paper) => [paper.paper_id, paper]));
  for (const paper of extra.papers) papers.set(paper.paper_id, { ...papers.get(paper.paper_id), ...paper, paper_id: paper.paper_id });
  const notes = new Map(base.notes.map((note) => [note.note_id, note]));
  for (const note of extra.notes) notes.set(note.note_id, note);
  const experiments = new Map(base.experiments.map((experiment) => [experiment.experiment_id, experiment]));
  for (const experiment of extra.experiments) experiments.set(experiment.experiment_id, experiment);
  return { papers: [...papers.values()], notes: [...notes.values()], experiments: [...experiments.values()] };
}

function batchHasConflict(kind: EvidenceQuery["kind"], evidence: ResearchEvidence): boolean {
  if (kind === "conflicts") return evidence.papers.length > 0 || evidence.notes.length > 0;
  const skeptical = evidence.notes.some((note) => note.type?.trim().toUpperCase() === "SKEPTICAL");
  const openerRequired = evidence.papers.some((paper) => paper.trusted_opener_required === true);
  const failed = evidence.experiments.some((experiment) => /^(fail|failed|failure)$/i.test(experiment.result?.trim() ?? ""));
  return skeptical || openerRequired || failed;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
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
