import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Experiment, Note, Paper } from "../data/repository.ts";
import { createResearchRepository } from "../data/research-repository.ts";
import type { DataSourceName, ResearchRepository } from "../data/research-repository.ts";
import { ResearchMemory } from "../memory/research-memory.ts";
import type { ResearchFinding } from "../memory/research-memory.ts";
import { createResearchModel } from "../llm/provider.ts";
import type { ChatMessage, ResearchModel, RouteId } from "../llm/provider.ts";
import { loadMarkovian } from "./markovian.ts";
import { ResearchTools, searchTerms } from "./tools.ts";
import type { EvidenceLedger, ToolTraceEntry } from "./tools.ts";
import { DECISIVE_CONFIDENCE, RELATIONSHIPS, composeAnswer, evaluateEvidence, hasEnoughEvidence, isDecisive, propositionOf } from "./evaluator.ts";
import type { Evaluation, LearnedConclusion, Proposition, Relationship } from "./evaluator.ts";

// The research agent (Phases 14-19). Each iteration is one Markovian chunk:
// H-MEM's recall enters chunk 0 as memory context, and only Markovian's
// bounded carryover state reaches later chunks. Within a chunk either the
// model (Nemotron through Meterless) drives the tools, or, with no model
// configured, a deterministic planner calls them in a fixed order.

export const MAX_ITERATIONS = 3;
const MAX_MODEL_TURNS_PER_ITERATION = 6;
const CONCLUSION_TAG = "agent:conclusion";
const CHUNK_CONFIG = { chunkSize: 4000, carryoverTokens: 640 };
const DEFAULT_MARKOVIAN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".markovian");

export function markovianHistoryDir(): string {
  const override = process.env.RESEARCH_OS_MARKOVIAN_DIR?.trim();
  return override ? path.resolve(override) : DEFAULT_MARKOVIAN_DIR;
}

export interface AgentOptions {
  useMemory?: boolean; // default true; false is the "cold" baseline
  learn?: boolean; // write conflicts, feedback and conclusions to H-MEM; default true with memory
  offline?: boolean; // ignore any configured model route
  maxIterations?: number;
  memory?: ResearchMemory;
  repository?: ResearchRepository;
  model?: ResearchModel;
}

export interface AgentIteration {
  step: number;
  carryoverIn: string;
  content: string;
  promptTokens: number;
  tools: ToolTraceEntry[];
}

export interface AgentLearning {
  enabled: boolean;
  stored?: ResearchFinding;
  conflicts: { memoryId: string; evidence: string[] }[];
  superseded: string[];
  helpful: string[];
  skipped?: string;
}

export interface AgentResult {
  question: string;
  mode: "offline" | "model";
  route?: { id: RouteId; model: string };
  dataSource: DataSourceName;
  memoryUsed: boolean;
  memoryContext?: string;
  recall: ToolTraceEntry[];
  // The post-run memory sweep in model mode; empty otherwise.
  verification: ToolTraceEntry[];
  iterations: AgentIteration[];
  run: {
    id: string;
    engine: string;
    status: string;
    chunks: number;
    promptTokens: number;
    outputTokens: number;
    tokensSaved: number;
    efficiencyPercent: number;
    tokenLabel: string;
  };
  evaluations: Evaluation[];
  evaluationSource: "rules" | "model" | "model+rules";
  answer: string;
  learning: AgentLearning;
  evidence: { papers: Paper[]; experiments: Experiment[]; notes: Note[] };
  memories: ResearchFinding[];
  notes: string[];
}

export async function runResearchAgent(question: string, options: AgentOptions = {}): Promise<AgentResult> {
  if (question.trim() === "") throw new Error("question must not be empty");
  const useMemory = options.useMemory ?? true;
  const learn = useMemory && (options.learn ?? true);
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS;
  const memory = useMemory ? (options.memory ?? (await ResearchMemory.create())) : undefined;
  const repository = options.repository ?? createResearchRepository();
  const model = options.offline ? undefined : (options.model ?? createResearchModel());
  const tools = new ResearchTools(memory, repository);
  const notes: string[] = [];

  let memoryContext: string | undefined;
  if (memory) {
    const recall = await tools.recall(question);
    if (recall.findings.length > 0) memoryContext = `${recall.context}\n${researchMetadata(recall.findings)}`;
  }

  const { Markovian, estimateTokens, source: engine } = await loadMarkovian();
  const markovian = new Markovian({ chunkConfig: { ...CHUNK_CONFIG, maxChunks: maxIterations }, historyDir: markovianHistoryDir() });
  const step = model ? modelStep(tools, model, maxIterations) : offlineStep(question, tools, maxIterations);
  const promptTokens: number[] = [];
  let iteration = 0;
  const run = await markovian.run({
    goal: question,
    mode: "RESEARCH",
    memoryContext,
    reflect: false,
    generator: async (prompt) => {
      iteration++;
      tools.iteration = iteration;
      promptTokens.push(estimateTokens(prompt));
      return { text: await step(prompt, iteration) };
    },
  });
  if (run.status === "errored") throw new Error(`research run failed: ${run.error}`);

  // Read the model's verdict against what it actually saw. Then sweep memory
  // for findings whose provenance cites the gathered papers: a store read, not
  // fuzzy recall, so a belief the evidence bears on is judged even when recall
  // missed it.
  const parsed = model ? parseModelConclusion(run.output, tools.ledger, notes) : undefined;
  const verifyStep = run.chunks.length + 1;
  if (memory && model && tools.ledger.papers.size > 0) {
    tools.iteration = verifyStep;
    await tools.memoriesCiting([...tools.ledger.papers.keys()]);
  }

  const ruleEvaluations = evaluateEvidence(question, tools.ledger);
  let evaluations = ruleEvaluations;
  let evaluationSource: AgentResult["evaluationSource"] = "rules";
  let answer: string;
  let learned: LearnedConclusion | undefined;
  if (parsed) {
    if (parsed.evaluations.length > 0) {
      // The rules act as a verification lane: any memory the model left
      // unjudged still gets checked against the evidence the model gathered.
      const judged = new Set(parsed.evaluations.map((e) => e.memoryId ?? "question"));
      const filled = evaluations.filter((e) => e.relationship !== "UNRELATED" && !judged.has(e.memoryId ?? "question"));
      evaluations = [...parsed.evaluations, ...filled];
      evaluationSource = filled.length > 0 ? "model+rules" : "model";
      if (filled.length > 0) {
        const ids = [...new Set(filled.map((e) => e.memoryId ?? "the question"))];
        notes.push(`The offline rules judged what the model left out: ${ids.join(", ")}.`);
      }
    } else {
      notes.push("The model returned no grounded evaluations; showing the offline rules' evaluation of the evidence it gathered.");
    }
    // Without a json answer, prefer the rules' grounded answer over the
    // evidence the model gathered (leftover model text is often a preamble);
    // fall back to that text only for questions the rules can't read.
    const fromRules = composeAnswer(question, ruleEvaluations, tools.ledger);
    const lastText = [...run.chunks].reverse().map((c) => c.content.replace(/```json[\s\S]*?```/gi, "").trim()).find(Boolean);
    const rulesCanAnswer = propositionOf(question) !== undefined;
    answer = parsed.answer?.trim() || (rulesCanAnswer ? fromRules.answer : lastText || fromRules.answer);
    if (!parsed.answer?.trim() && (rulesCanAnswer || !lastText)) {
      notes.push("The model wrote no final answer; this one is assembled by the offline rules from the evidence it gathered.");
    }
    learned = parsed.learned ?? fromRules.learned;
    if (!parsed.learned && fromRules.learned) notes.push("The conclusion to remember comes from the offline rules, since the model gave none.");
  } else {
    ({ answer, learned } = composeAnswer(question, evaluations, tools.ledger));
  }

  const learning = memory && learn
    ? applyLearning(memory, tools.ledger, evaluations, learned)
    : { enabled: false, conflicts: [], superseded: [], helpful: [] };
  if (model?.fallbackEvents.length) notes.push(...model.fallbackEvents);

  const current = new Map((memory?.listResearchFindings() ?? []).map((f) => [f.id, f]));
  const route = model ? (model.lastRoute ?? model.route) : undefined;
  return {
    question,
    mode: model ? "model" : "offline",
    route: route && { id: route.id, model: route.model },
    dataSource: repository.source,
    memoryUsed: useMemory,
    memoryContext,
    recall: tools.trace.filter((t) => t.iteration === 0),
    verification: tools.trace.filter((t) => t.iteration === verifyStep),
    iterations: run.chunks.map((chunk, index) => ({
      step: chunk.id,
      carryoverIn: chunk.carryover,
      content: chunk.content,
      promptTokens: promptTokens[index] ?? 0,
      tools: tools.trace.filter((t) => t.iteration === chunk.id),
    })),
    run: {
      id: run.id,
      engine,
      status: run.status,
      chunks: run.chunks.length,
      promptTokens: promptTokens.reduce((sum, t) => sum + t, 0),
      outputTokens: run.totalTokensUsed,
      tokensSaved: run.totalTokensSaved,
      efficiencyPercent: run.efficiencyPercent,
      tokenLabel: run.tokenLabel,
    },
    evaluations,
    evaluationSource,
    answer,
    learning,
    evidence: {
      papers: [...tools.ledger.papers.values()],
      experiments: [...tools.ledger.experiments.values()],
      notes: [...tools.ledger.notes.values()],
    },
    memories: [...tools.ledger.memories.values()].map((f) => current.get(f.id) ?? f),
    notes,
  };
}

// Phase 18: the same question with and without research memory.
export async function compareColdWarm(question: string, options: Omit<AgentOptions, "useMemory"> = {}): Promise<{ cold: AgentResult; warm: AgentResult }> {
  const cold = await runResearchAgent(question, { ...options, useMemory: false, learn: false });
  const warm = await runResearchAgent(question, { ...options, useMemory: true, learn: options.learn ?? false });
  return { cold, warm };
}

function researchMetadata(findings: ResearchFinding[]): string {
  const lines = findings.map((f) => {
    const sources = f.sourceIds.length > 0 ? f.sourceIds.join(",") : "none";
    const revised = f.supersededBy ? `, superseded by ${f.supersededBy}` : "";
    return `- ${f.id} ${f.type}, confidence ${f.confidence}, sources ${sources}${revised}`;
  });
  return ["[RESEARCH MEMORY METADATA]", ...lines, "[/RESEARCH MEMORY METADATA]"].join("\n");
}

function evaluationLine(e: Evaluation): string {
  return `${e.evidence.join("+") || "-"} ${e.relationship} ${e.memoryId ?? "the question"} (${e.confidence.toFixed(2)})`;
}

function topic(proposition: Proposition | undefined): string | undefined {
  return proposition === "TRUSTED_OPENER_REQUIRED" || proposition === "TRACEABLE_WITHOUT_TRUSTED_OPENER" ? "opener" : proposition;
}

// Conclusions an earlier run stored on the same topic, still in force.
function settledConclusions(question: string, ledger: EvidenceLedger): ResearchFinding[] {
  const wanted = topic(propositionOf(question));
  if (!wanted) return [];
  return [...ledger.memories.values()].filter(
    (f) => f.tags.includes(CONCLUSION_TAG) && !f.supersededBy && f.sourceIds.length > 0 && topic(propositionOf(f.content)) === wanted,
  );
}

function offlineStep(question: string, tools: ResearchTools, maxIterations: number) {
  const completed: string[] = [];
  return async (_prompt: string, i: number): Promise<string> => {
    const actions: string[] = [];
    if (i === 1) {
      const settled = settledConclusions(question, tools.ledger);
      if (settled.length > 0) {
        const sourceIds = [...new Set(settled.flatMap((f) => f.sourceIds))];
        const papers = await tools.getPapers(sourceIds);
        await tools.getExperiments(papers.map((p) => p.paper_id));
        actions.push(`>> memory already holds ${settled.map((f) => f.id).join(", ")}; re-checked its cited evidence ${sourceIds.join(", ")}`);
      } else {
        const papers = await tools.searchPapers(question);
        actions.push(`>> searched papers for "${searchTerms(question).join(" ")}": ${papers.map((p) => p.paper_id).join(", ") || "none"}`);
      }
    } else if (i === 2) {
      const paperIds = [...tools.ledger.papers.keys()];
      const experiments = await tools.getExperiments(paperIds);
      const notes = await tools.getNotes(paperIds);
      actions.push(`>> corroborated ${paperIds.join(", ") || "nothing"}: experiments ${experiments.map((e) => `${e.experiment_id} ${e.result}`).join(", ") || "none"}; notes ${notes.map((n) => n.note_id).join(", ") || "none"}`);
      if (tools.usesMemory) {
        const citing = await tools.memoriesCiting(paperIds);
        actions.push(`>> memories citing them: ${citing.map((f) => f.id).join(", ") || "none"}`);
      }
    } else {
      const rows = await tools.crossSource();
      actions.push(`>> ran the post-quantum cross-source query: ${rows.length} rows`);
    }
    completed.push(...actions.map((a) => a.replace(/^>> /, "")));

    const evaluations = evaluateEvidence(question, tools.ledger);
    const relations = evaluations.filter((e) => e.relationship !== "UNRELATED").map(evaluationLine);
    const body = [...actions, ...relations.map((r) => `- ${r}`)].join("\n");
    if (hasEnoughEvidence(question, evaluations) || i >= maxIterations) return `${body}\n[TASK_COMPLETE]`;

    const remaining = i === 1
      ? "corroborate candidate papers with experiments and notes; follow memory provenance"
      : "sweep the post-quantum cross-source query";
    const decided = evaluations.filter((e) => e.relationship !== "UNRELATED" && e.confidence >= 0.7).map(evaluationLine);
    return [
      body,
      "[STATE_CHECKPOINT]",
      `COMPLETED: ${completed.join("; ")}`,
      `REMAINING: ${remaining}`,
      `DECISIONS: ${decided.join("; ") || "none yet"} (decisive at ${DECISIVE_CONFIDENCE})`,
      `CONTEXT: question: ${question}`,
    ].join("\n");
  };
}

function systemPrompt(tools: ResearchTools, maxIterations: number): string {
  const evidenceSource = tools.repository.source === "zetaris" ? "Zetaris (governed research data)" : "the local evidence store";
  const memory = tools.usesMemory
    ? "Research memory (H-MEM) holds the researcher's earlier conclusions as mem-N records with confidence and cited sources; superseded ones have already been revised."
    : "Research memory is switched off for this run: work from the evidence alone and set memory_id to null.";
  return [
    `You are the research agent of ResearchOS. You answer research questions by comparing what the researcher already concluded against the evidence (papers, experiments, researcher notes) served by ${evidenceSource}.`,
    memory,
    `You have at most ${maxIterations} iterations. In each one, call tools to gather what you need, then write a short summary of what you found.`,
    "Cite only IDs that tools returned (papers P..., experiments E..., notes N..., memories mem-...). Anything else is discarded.",
    "When the evidence is enough to answer, or in the last iteration, write the final answer and then one fenced ```json block:",
    '{"answer": "...", "evaluations": [{"relationship": "SUPPORTS|CONTRADICTS|EXTENDS|UNRELATED", "memory_id": "mem-N or null for the question itself", "evidence": ["P007", "E002"], "confidence": 0.85, "reason": "..."}], "learned": {"content": "one-sentence conclusion worth remembering", "evidence": ["P007"], "confidence": 0.85} or null}',
    "confidence is your own judgement, from 0 to 1, of how strongly the cited evidence establishes the relationship: about 0.9 when a paper and a passing experiment state it directly, about 0.7 for a single paper, lower when you are inferring. Never copy the example values.",
    "Every evaluation needs one of the four relationships. Include one for the question itself (memory_id null): SUPPORTS if the evidence answers it yes, CONTRADICTS if no, EXTENDS if only in part. Then judge every memory the tools returned, so a belief the evidence refutes is caught. Judge a memory by whether the evidence agrees with what that memory says: a memory recording that two sources disagree gets SUPPORTS when the evidence shows that disagreement. Evidence means papers, experiments and notes, never memories. Cite the experiments that corroborate a paper alongside it.",
    "Don't repeat a tool call you already made with the same arguments. Finish as soon as the evidence answers the question.",
    "End that final chunk with [TASK_COMPLETE]. Otherwise end with [STATE_CHECKPOINT] and the COMPLETED/REMAINING/DECISIONS/CONTEXT block.",
  ].join("\n");
}

function modelStep(tools: ResearchTools, model: ResearchModel, maxIterations: number) {
  const system = systemPrompt(tools, maxIterations);
  return async (prompt: string, i: number): Promise<string> => {
    const last = i >= maxIterations ? " It is the last one: finish with the final answer, the json block and [TASK_COMPLETE]." : "";
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: `${prompt}\n\nThis is iteration ${i} of ${maxIterations}.${last}` },
    ];
    // The tool loop stays inside the chunk; only Markovian's carryover leaves it.
    let text = "";
    for (let turn = 1; ; turn++) {
      const allowTools = turn < MAX_MODEL_TURNS_PER_ITERATION;
      const reply = await model.chat(messages, allowTools ? tools.definitions() : undefined);
      if (!allowTools || !reply.tool_calls?.length) {
        text = stripThinking(reply.content ?? "");
        break;
      }
      messages.push(reply);
      for (const call of reply.tool_calls) {
        messages.push({ role: "tool", tool_call_id: call.id, content: await tools.call(call.function.name, call.function.arguments) });
      }
    }
    // A final chunk without the json block gets one reminder.
    const finishing = i >= maxIterations || /\[TASK_COMPLETE\]/.test(text);
    if (finishing && !/```json/i.test(text)) {
      messages.push(
        { role: "assistant", content: text },
        { role: "user", content: "Now write the final answer and the ```json block described in the instructions, then [TASK_COMPLETE]." },
      );
      const retry = stripThinking((await model.chat(messages)).content ?? "");
      text = [text.replace(/\[TASK_COMPLETE\]/g, "").trim(), retry].filter(Boolean).join("\n");
      if (!/\[TASK_COMPLETE\]/.test(text)) text += "\n[TASK_COMPLETE]";
    }
    return text;
  };
}

// Reasoning models may wrap their thinking in <think> tags.
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Models sometimes inflect the relationship word; these mean the same thing.
const RELATIONSHIP_VARIANTS = new Map<string, Relationship>([
  ["SUPPORTED", "SUPPORTS"], ["SUPPORT", "SUPPORTS"],
  ["CONTRADICTED", "CONTRADICTS"], ["CONTRADICT", "CONTRADICTS"],
  ["EXTENDED", "EXTENDS"], ["EXTEND", "EXTENDS"],
]);

// Accepts the model's evaluations only where they cite evidence the tools
// actually returned during this run.
function parseModelConclusion(output: string, ledger: EvidenceLedger, notes: string[]): { answer?: string; evaluations: Evaluation[]; learned?: LearnedConclusion } {
  const raw = [...output.matchAll(/```json\s*([\s\S]*?)```/gi)].at(-1)?.[1];
  if (!raw) {
    notes.push("The model's final chunk had no ```json block.");
    return { evaluations: [] };
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    notes.push("The model's ```json block was not valid JSON.");
    return { evaluations: [] };
  }

  const grounded = (value: unknown, label: string): string[] => {
    const ids = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    const ungrounded = ids.filter((id) => !ledger.isGrounded(id));
    if (ungrounded.length > 0) notes.push(`Dropped ${label} citations the tools never returned: ${ungrounded.join(", ")}.`);
    return ids.filter((id) => ledger.isGrounded(id));
  };
  const confidenceOf = (value: unknown) => (typeof value === "number" && value >= 0 && value <= 1 ? value : undefined);

  const evaluations: Evaluation[] = [];
  for (const item of Array.isArray(data.evaluations) ? data.evaluations : []) {
    const e = item as Record<string, unknown>;
    const word = typeof e.relationship === "string" ? e.relationship.trim().toUpperCase() : "";
    const relationship = RELATIONSHIPS.includes(word as Relationship) ? (word as Relationship) : RELATIONSHIP_VARIANTS.get(word);
    const memoryId = typeof e.memory_id === "string" ? e.memory_id : null;
    const confidence = confidenceOf(e.confidence);
    if (!relationship || confidence === undefined) {
      notes.push(`Dropped a malformed evaluation: ${JSON.stringify(item).slice(0, 120)}`);
      continue;
    }
    if (memoryId && !ledger.memories.has(memoryId)) {
      notes.push(`Dropped an evaluation of ${memoryId}, which no tool returned.`);
      continue;
    }
    const cited = grounded(e.evidence, "evaluation");
    // Memories are what is being judged, not evidence for it.
    const evidence = cited.filter((id) => !id.startsWith("mem-"));
    if (evidence.length < cited.length) notes.push(`Memories aren't evidence: dropped ${cited.filter((id) => id.startsWith("mem-")).join(", ")} from a citation.`);
    if (relationship !== "UNRELATED" && evidence.length === 0) continue;
    evaluations.push({ relationship, memoryId, evidence, confidence, reason: typeof e.reason === "string" ? e.reason : "", by: "model" });
  }

  let learned: LearnedConclusion | undefined;
  const l = data.learned as Record<string, unknown> | null | undefined;
  if (l && typeof l.content === "string" && l.content.trim()) {
    const evidence = grounded(l.evidence, "conclusion").filter((id) => !id.startsWith("mem-"));
    const confidence = confidenceOf(l.confidence);
    if (evidence.length > 0 && confidence !== undefined) learned = { content: l.content.trim(), evidence, confidence };
  }
  return { answer: typeof data.answer === "string" ? data.answer : undefined, evaluations, learned };
}

// Writes what this run learned into H-MEM, each step through an H-MEM API
// that leaves a ledger entry.
function applyLearning(memory: ResearchMemory, ledger: EvidenceLedger, evaluations: Evaluation[], learned?: LearnedConclusion): AgentLearning {
  const learning: AgentLearning = { enabled: true, conflicts: [], superseded: [], helpful: [] };
  const active = (id: string | null) => id !== null && ledger.memories.has(id) && !ledger.memories.get(id)!.supersededBy;
  const decisive = evaluations.filter((e) => active(e.memoryId) && isDecisive(e));

  const contradicted = new Map<string, Evaluation[]>();
  for (const e of decisive.filter((e) => e.relationship === "CONTRADICTS")) {
    contradicted.set(e.memoryId!, [...(contradicted.get(e.memoryId!) ?? []), e]);
  }
  for (const [memoryId, found] of contradicted) {
    const evidence = [...new Set(found.flatMap((e) => e.evidence))];
    memory.recordConflict(memoryId, { evidence, reason: found[0].reason, confidence: Math.max(...found.map((e) => e.confidence)) });
    learning.conflicts.push({ memoryId, evidence });
  }

  // A counterexample outweighs consistent instances, so contradicted memories
  // get no helpful feedback.
  const supported = new Set(decisive.filter((e) => e.relationship === "SUPPORTS" && !contradicted.has(e.memoryId!)).map((e) => e.memoryId!));
  for (const memoryId of supported) {
    memory.markHelpful(memoryId);
    learning.helpful.push(memoryId);
  }

  if (!learned || learned.confidence < DECISIVE_CONFIDENCE) {
    learning.skipped = learned ? "the conclusion is not decisive enough to remember" : "no new conclusion to remember";
    return learning;
  }
  const existing = memory.listResearchFindings().find((f) => !f.supersededBy && f.content.trim() === learned.content.trim());
  if (existing) {
    learning.skipped = `already remembered as ${existing.id}`;
    return learning;
  }
  const input = {
    type: "CLAIM" as const,
    content: learned.content,
    sourceIds: learned.evidence.filter((id) => !id.startsWith("mem-")),
    confidence: learned.confidence,
    tags: [CONCLUSION_TAG],
  };
  const replaced = [...contradicted.keys()];
  learning.stored = replaced.length > 0 ? memory.reviseResearchFindings(replaced, input) : memory.rememberResearchFinding(input);
  learning.superseded = replaced;
  return learning;
}
