import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContradictionEvaluator } from "./src/agents/evaluator.ts";
import { ResearchAgent } from "./src/agents/research-agent.ts";
import type { ContradictionReport, ResearchContext } from "./src/agents/types.ts";
import { ResearchMemory } from "./src/memory/research-memory.ts";
import { DeterministicResearchReasoner } from "./src/reasoning/deterministic-reasoner.ts";
import { LLMResearchReasoner } from "./src/reasoning/llm-reasoner.ts";
import type { MemoryRecord, RetrievedMemory } from "./vendor/hmem/src/types.ts";
import { ZetarisResearchRepository } from "./src/zetaris/repository.ts";
import { ZetarisClientError, type ZetarisErrorKind } from "./src/zetaris/types.ts";

const QUESTION = "Can post-quantum anonymity and traceability be achieved without requiring a single trusted opener?";
const PLANTED_ID = "mem-test-opener";
const PLANTED_BELIEF = "Current working assumption: practical traceability still requires a single trusted opener.";

const ERROR_CATEGORY: Record<ZetarisErrorKind, string> = {
  config: "CONFIGURATION_ERROR",
  connection: "CONNECTION_ERROR",
  auth: "AUTHENTICATION_ERROR",
  query: "QUERY_ERROR",
};

function loadResearchOsEnv(): void {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function plantedMemory(): RetrievedMemory {
  const memory: MemoryRecord = {
    id: PLANTED_ID,
    content: PLANTED_BELIEF,
    type: "factual",
    layer: "long_term",
    timestamp: 0,
    lastAccessed: 0,
    accessCount: 0,
    tags: ["CLAIM"],
    embedding: [],
    confidence: 0.8,
    source: "P007",
    provenance: { origin: "document", learnedAt: 0, label: "CLAIM", refs: ["P007"] },
    domain: "research",
    namespace: "research-os",
    entities: [],
    relatedTo: [],
  };
  return { memory, relevance: 1 };
}

function validSourceIds(context: ResearchContext): string[] {
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
  return [...ids].sort();
}

function addId(ids: Set<string>, value: string | undefined): void {
  const id = value?.trim();
  if (id) ids.add(id);
}

function printList(values: string[]): void {
  if (values.length === 0) {
    console.log("none");
    return;
  }
  for (const value of values) console.log(value);
}

function printReports(reports: ContradictionReport[]): void {
  if (reports.length === 0) {
    console.log("none");
    return;
  }
  for (const report of reports) {
    console.log(`${report.memoryId} ${report.relationship}`);
    console.log(`evidence: ${report.evidence.join(", ") || "none"}`);
    console.log(`confidence: ${report.confidence}`);
    console.log(`reason: ${report.reason}`);
    console.log(`recommendation: ${report.recommendation}`);
    console.log("");
  }
}

function structuralProblems(reports: ContradictionReport[], context: ResearchContext): string[] {
  const memoryIds = new Set(context.priorMemories.memories.map((hit) => hit.memory.id));
  const sources = new Set(validSourceIds(context));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const report of reports) {
    if (!memoryIds.has(report.memoryId)) problems.push(`unknown memory ${report.memoryId}`);
    if (seen.has(report.memoryId)) problems.push(`repeated memory ${report.memoryId}`);
    seen.add(report.memoryId);
    if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
      problems.push(`invalid confidence for ${report.memoryId}`);
    }
    for (const id of report.evidence) {
      if (!sources.has(id)) problems.push(`unknown evidence ${id} on ${report.memoryId}`);
    }
    if (report.relationship === "CONTRADICTS" && report.recommendation !== "Revise existing conclusion.") {
      problems.push(`contradiction recommendation changed for ${report.memoryId}`);
    }
  }
  for (const id of memoryIds) {
    if (!seen.has(id)) problems.push(`missing report for ${id}`);
  }
  return problems;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "LLM request failed.";
  return message.replace(/sk-[A-Za-z0-9_\-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

try {
  loadResearchOsEnv();
  const memory = await ResearchMemory.create();
  const repository = ZetarisResearchRepository.fromEnv();
  const agent = new ResearchAgent(memory, repository, new DeterministicResearchReasoner());
  const context = await agent.gatherResearchContext(QUESTION);
  context.priorMemories.memories.unshift(plantedMemory());
  const conclusion = await new DeterministicResearchReasoner().assess(context);
  const deterministic = await new ContradictionEvaluator(new DeterministicResearchReasoner()).evaluate(context, conclusion);
  const llm = await new ContradictionEvaluator(new LLMResearchReasoner()).evaluate(context, conclusion);
  const planted = llm.find((report) => report.memoryId === PLANTED_ID);
  const problems = [
    ...structuralProblems(deterministic, context).map((problem) => `deterministic ${problem}`),
    ...structuralProblems(llm, context).map((problem) => `llm ${problem}`),
  ];
  const deterministicPlanted = deterministic.find((report) => report.memoryId === PLANTED_ID);
  if (deterministicPlanted?.relationship !== "CONTRADICTS") problems.push("deterministic planted belief was not CONTRADICTS");
  if (planted?.relationship !== "CONTRADICTS") problems.push("llm planted belief was not CONTRADICTS");

  console.log("");
  console.log("PLANTED BELIEF");
  console.log(PLANTED_BELIEF);
  console.log("");
  console.log("DETERMINISTIC");
  printReports(deterministic);
  console.log("LLM");
  printReports(llm);
  console.log("VALID MEMORY IDS");
  printList(context.priorMemories.memories.map((hit) => hit.memory.id));
  console.log("");
  console.log("VALID SOURCE IDS");
  printList(validSourceIds(context));
  console.log("");
  console.log("CHECKS");
  if (problems.length === 0) {
    console.log("pass");
  } else {
    for (const problem of problems) console.log(problem);
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof ZetarisClientError) {
    console.error(ERROR_CATEGORY[error.kind]);
  } else {
    console.error(safeMessage(error));
  }
  process.exitCode = 1;
}
