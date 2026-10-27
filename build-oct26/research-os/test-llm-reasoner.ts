import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchAgent } from "./src/agents/research-agent.ts";
import type { ResearchContext } from "./src/agents/types.ts";
import { ResearchMemory } from "./src/memory/research-memory.ts";
import { DeterministicResearchReasoner } from "./src/reasoning/deterministic-reasoner.ts";
import { LLMResearchReasoner } from "./src/reasoning/llm-reasoner.ts";
import { ZetarisResearchRepository } from "./src/zetaris/repository.ts";
import { ZetarisClientError, type ZetarisErrorKind } from "./src/zetaris/types.ts";

const QUESTION = "Can post-quantum anonymity and traceability be achieved without requiring a single trusted opener?";

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
  const conclusion = await new LLMResearchReasoner().assess(context);

  console.log("");
  console.log("ASSESSMENT");
  console.log(conclusion.assessment);
  console.log("");
  console.log("SUMMARY");
  console.log(conclusion.summary);
  console.log("");
  console.log("CONFIDENCE");
  console.log(conclusion.confidence);
  console.log("");
  console.log("SUPPORTING SOURCES");
  printList(conclusion.supportingSourceIds);
  console.log("");
  console.log("CONFLICTING SOURCES");
  printList(conclusion.conflictingSourceIds);
  console.log("");
  console.log("OPEN QUESTIONS");
  printList(conclusion.openQuestions);
  console.log("");
  console.log("VALID SOURCE IDS");
  printList(validSourceIds(context));
} catch (error) {
  if (error instanceof ZetarisClientError) {
    console.error(ERROR_CATEGORY[error.kind]);
  } else {
    console.error(safeMessage(error));
  }
  process.exitCode = 1;
}
