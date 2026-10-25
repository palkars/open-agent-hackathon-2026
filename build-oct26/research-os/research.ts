import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchAgentResult } from "./src/agents/types.ts";
import { searchPapers } from "./src/data/repository.ts";
import type { Experiment, Paper, ResearchEvidence, ResearchNote } from "./src/data/types.ts";
import { ZetarisResearchRepository, type PotentiallyConflictingEvidence, type TraceableScheme } from "./src/zetaris/repository.ts";
import { ZetarisClientError, type ZetarisErrorKind } from "./src/zetaris/types.ts";
import type { QueryResult } from "../vendor/hmem/src/types.ts";

function printRetrievedMemory(hit: QueryResult["memories"][number], trace: QueryResult["trace"]): void {
  const record = hit.memory;
  console.log(`[${record.id}]`);
  if (record.type) console.log(`Type: ${record.type}`);
  if (record.content) console.log(`Content: ${record.content}`);
  if (record.confidence !== undefined) console.log(`Confidence: ${record.confidence}`);
  if (record.source) console.log(`Source paper ID(s): ${record.source}`);
  if (record.tags.length > 0) console.log(`Tags: ${record.tags.join(", ")}`);
  if (hit.relevance !== undefined) console.log(`Retrieval score: ${hit.relevance}`);
  else if (record.score !== undefined) console.log(`Retrieval score: ${record.score}`);

  const provenance = record.provenance;
  if (provenance) {
    const lines: string[] = [];
    if (provenance.origin) lines.push(`  origin: ${provenance.origin}`);
    if (provenance.learnedAt !== undefined) lines.push(`  learnedAt: ${provenance.learnedAt}`);
    if (provenance.label) lines.push(`  label: ${provenance.label}`);
    if (provenance.refs && provenance.refs.length > 0) lines.push(`  refs: ${provenance.refs.join(", ")}`);
    if (lines.length > 0) {
      console.log("Provenance:");
      for (const line of lines) console.log(line);
    }
  }

  const traceLines: string[] = [];
  if (trace.retrievalReason) traceLines.push(`  retrievalReason: ${trace.retrievalReason}`);
  if (trace.strategy) traceLines.push(`  strategy: ${trace.strategy}`);
  const tracedScore = trace.scores[record.id];
  if (tracedScore !== undefined) traceLines.push(`  score: ${tracedScore}`);
  if (traceLines.length > 0) {
    console.log("Trace:");
    for (const line of traceLines) console.log(line);
  }
  console.log("");
}

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

function flag(value: boolean | null | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

function measure(value: number | undefined, unit: string): string {
  return value === undefined ? "unknown" : `${value} ${unit}`;
}

function printPaperEvidence(evidence: ResearchEvidence): void {
  const paper = evidence.papers[0];
  if (!paper) {
    console.log("No paper returned.");
  } else {
    printPaper(paper);
  }
  console.log("");
  if (evidence.notes.length === 0) {
    console.log("Research note:");
    console.log("No note returned.");
  } else {
    for (const note of evidence.notes) printNote(note);
  }
  console.log("");
  if (evidence.experiments.length === 0) {
    console.log("Experiment:");
    console.log("No experiment returned.");
    return;
  }
  for (const [index, experiment] of evidence.experiments.entries()) {
    if (index > 0) console.log("");
    printExperiment(experiment);
  }
}

function printPaper(paper: Paper): void {
  console.log(`Paper ID: ${paper.paper_id}`);
  console.log(`Title: ${paper.title}`);
  console.log(`Crypto family: ${paper.crypto_family ?? "unknown"}`);
  console.log(`Crypto method: ${paper.crypto_method ?? "unknown"}`);
  console.log(`Anonymity: ${flag(paper.provides_anonymity)}`);
  console.log(`Traceability: ${flag(paper.provides_traceability)}`);
  console.log(`Trusted opener required: ${flag(paper.trusted_opener_required)}`);
  console.log(`Key claim: ${paper.key_claim ?? ""}`);
}

function printNote(note: ResearchNote): void {
  console.log("Research note:");
  console.log(`Stance: ${note.type ?? "unknown"}`);
  console.log(`Confidence: ${note.confidence ?? "unknown"}`);
  console.log(`Note: ${note.text}`);
}

function printSchemes(schemes: TraceableScheme[]): void {
  if (schemes.length === 0) {
    console.log("No schemes returned.");
    return;
  }

  const headers = ["Paper", "Method", "Trusted opener", "Verify time", "Signature size", "Experiment result"];
  const rows = schemes.map((scheme) => [
    scheme.paper_id,
    scheme.crypto_method,
    flag(scheme.trusted_opener_required),
    scheme.verify_time_ms === undefined ? "unknown" : String(scheme.verify_time_ms),
    scheme.signature_size_bytes === undefined ? "unknown" : String(scheme.signature_size_bytes),
    scheme.result ?? "unknown",
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const format = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(format(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(format(row));
}

function printPotentiallyConflictingEvidence(rows: PotentiallyConflictingEvidence[]): void {
  console.log("Potentially conflicting evidence");
  console.log("Retrieved where the research note stance is SKEPTICAL. Not a confirmed contradiction.");
  console.log("");
  if (rows.length === 0) {
    console.log("No potentially conflicting evidence returned.");
    return;
  }
  for (const [index, row] of rows.entries()) {
    if (index > 0) console.log("");
    console.log(`Paper ID: ${row.paper_id}`);
    console.log(`Title: ${row.title}`);
    console.log(`Key claim: ${row.key_claim ?? ""}`);
    console.log(`Trusted opener required: ${flag(row.trusted_opener_required)}`);
    console.log(`Note stance: ${row.note_stance}`);
    console.log(`Note confidence: ${row.note_confidence ?? "unknown"}`);
    console.log(`Researcher note: ${row.researcher_note}`);
    console.log(`Experiment result: ${row.experiment_result ?? "unknown"}`);
  }
}

const SAFE_RESEARCH_FAILURES = new Set([
  "MEMORY_RETRIEVAL_ERROR",
  "ZETARIS_AUTHENTICATION_ERROR",
  "ZETARIS_CONNECTION_ERROR",
  "REASONING_ERROR",
  "Research question cannot be empty",
]);

function safeResearchFailure(error: unknown): string {
  if (error instanceof Error && SAFE_RESEARCH_FAILURES.has(error.message)) return error.message;
  if (error instanceof ZetarisClientError) {
    if (error.kind === "auth") return "ZETARIS_AUTHENTICATION_ERROR";
    if (error.kind === "config" && /password|api[_ ]?key|username|credential|unauthor|forbidden/i.test(error.message)) {
      return "ZETARIS_AUTHENTICATION_ERROR";
    }
    return "ZETARIS_CONNECTION_ERROR";
  }
  return "MEMORY_RETRIEVAL_ERROR";
}

function printLines(values: string[]): void {
  if (values.length === 0) {
    console.log("none");
    return;
  }
  for (const value of values) console.log(value);
}

function printCurrentEvidence(evidence: ResearchAgentResult["context"]["currentEvidence"]): void {
  if (!Array.isArray(evidence)) {
    if (evidence.papers.length === 0 && evidence.notes.length === 0 && evidence.experiments.length === 0) {
      console.log("none");
      return;
    }
    for (const paper of evidence.papers) {
      console.log(`- ${paper.paper_id}: ${paper.title}`);
      console.log(`  method ${paper.crypto_method ?? "unknown"}; anonymity ${flag(paper.provides_anonymity)}; traceability ${flag(paper.provides_traceability)}; trusted opener ${flag(paper.trusted_opener_required)}`);
    }
    return;
  }
  if (evidence.length === 0) {
    console.log("none");
    return;
  }
  for (const row of evidence) {
    if ("researcher_note" in row) {
      console.log(`- ${row.paper_id}: ${row.title}`);
      console.log(`  stance ${row.note_stance}; trusted opener ${flag(row.trusted_opener_required)}; experiment ${row.experiment_result ?? "unknown"}`);
      console.log(`  ${row.researcher_note}`);
      continue;
    }
    console.log(`- ${row.paper_id}: ${row.title}`);
    console.log(`  method ${row.crypto_method}; anonymity ${flag(row.provides_anonymity)}; traceability ${flag(row.provides_traceability)}; trusted opener ${flag(row.trusted_opener_required)}`);
    console.log(`  verify ${measure(row.verify_time_ms, "ms")}; signature ${measure(row.signature_size_bytes, "bytes")}; result ${row.result ?? "unknown"}`);
  }
}

function printResearchResult(result: ResearchAgentResult): void {
  const { context, conclusion } = result;
  console.log("");
  console.log("QUESTION");
  console.log(context.question.question);
  console.log("");
  console.log("PRIOR KNOWLEDGE");
  console.log("source: Meterless H-MEM");
  const memories = context.priorMemories.memories;
  if (memories.length === 0) {
    console.log("none");
  } else {
    for (const hit of memories) {
      const record = hit.memory;
      const kind = record.provenance?.label?.trim() || record.type;
      const refs = record.provenance?.refs?.filter((ref) => ref.trim()).join(", ") || record.source || "unknown";
      console.log(`- ${kind} (${record.confidence}) [${refs}]`);
      console.log(`  ${record.content}`);
    }
  }
  console.log("");
  console.log("CURRENT EVIDENCE");
  console.log("source: Zetaris");
  printCurrentEvidence(context.currentEvidence);
  console.log("");
  console.log("ASSESSMENT");
  console.log(conclusion.assessment);
  console.log("");
  console.log("CONCLUSION");
  console.log(conclusion.summary);
  console.log("");
  console.log("CONFIDENCE");
  console.log(conclusion.confidence);
  console.log("");
  console.log("SUPPORTING SOURCES");
  printLines(conclusion.supportingSourceIds);
  console.log("");
  console.log("CONFLICTING SOURCES");
  printLines(conclusion.conflictingSourceIds);
  console.log("");
  console.log("OPEN QUESTIONS");
  printLines(conclusion.openQuestions.map((question) => `- ${question}`));
  console.log("");
  console.log("MEMORY STORED");
  if (result.memoryStored) console.log(result.storedMemoryId ? `yes (${result.storedMemoryId})` : "yes");
  else if (result.storedMemoryId) console.log(`already stored (${result.storedMemoryId})`);
  else console.log("no");
  console.log("");
  console.log("TIMINGS");
  console.log(`memory retrieval: ${result.timings.memoryRetrievalMs} ms`);
  console.log(`zetaris retrieval: ${result.timings.zetarisRetrievalMs} ms`);
  console.log(`reasoning: ${result.timings.reasoningMs} ms`);
  console.log(`memory store: ${result.timings.memoryStoreMs} ms`);
  console.log(`total: ${result.timings.totalMs} ms`);
}

function printExperiment(experiment: Experiment): void {
  console.log("Experiment:");
  console.log(`Scheme: ${experiment.scheme}`);
  console.log(`Verify time: ${measure(experiment.verify_time_ms, "ms")}`);
  console.log(`Signature size: ${measure(experiment.signature_size_bytes, "bytes")}`);
  console.log(`Communication size: ${measure(experiment.communication_kb, "kb")}`);
  console.log(`Result: ${experiment.result ?? "unknown"}`);
}

const [command, query, ...extra] = process.argv.slice(2);

if (command === "search") {
  if (!query?.trim()) {
    console.error('Usage: npx tsx research-os/research.ts search "<query>"');
    process.exitCode = 1;
  } else {
    for (const paper of searchPapers(query)) {
      console.log(`${paper.paper_id}\n${paper.title}\n`);
    }
  }
} else if (command === "evidence") {
  if (!query?.trim()) {
    console.error("Usage: npx tsx research-os/research.ts evidence <paperId>");
    process.exitCode = 1;
  } else {
    try {
      loadResearchOsEnv();
      const repository = ZetarisResearchRepository.fromEnv();
      printPaperEvidence(await repository.getPaperEvidence(query.trim()));
    } catch (error) {
      if (error instanceof ZetarisClientError) {
        console.error(ERROR_CATEGORY[error.kind]);
        console.error(error.message);
      } else {
        console.error("CONNECTION_ERROR");
      }
      process.exitCode = 1;
    }
  }
} else if (command === "schemes") {
  try {
    loadResearchOsEnv();
    const repository = ZetarisResearchRepository.fromEnv();
    const schemes = await repository.findPostQuantumAnonymousTraceableSchemes();
    printSchemes(schemes);
    if (schemes.length === 0) process.exitCode = 1;
  } catch (error) {
    if (error instanceof ZetarisClientError) {
      console.error(ERROR_CATEGORY[error.kind]);
      console.error(error.message);
    } else {
      console.error("CONNECTION_ERROR");
    }
    process.exitCode = 1;
  }
} else if (command === "evidence-conflicts") {
  try {
    loadResearchOsEnv();
    const repository = ZetarisResearchRepository.fromEnv();
    const rows = await repository.getPotentiallyConflictingEvidence();
    printPotentiallyConflictingEvidence(rows);
    if (rows.length === 0) process.exitCode = 1;
  } catch (error) {
    if (error instanceof ZetarisClientError) {
      console.error(ERROR_CATEGORY[error.kind]);
      console.error(error.message);
    } else {
      console.error("CONNECTION_ERROR");
    }
    process.exitCode = 1;
  }
} else if (command === "seed-memory") {
  const { ResearchMemory, seedResearchNotes } = await import("./src/memory/research-memory.ts");
  const memory = await ResearchMemory.create();
  seedResearchNotes(memory);
} else if (command === "audit") {
  if (!query?.trim()) {
    console.error("Usage: npx tsx research-os/research.ts audit <memory-id>");
    process.exitCode = 1;
  } else {
    const { ResearchMemory } = await import("./src/memory/research-memory.ts");
    const memory = await ResearchMemory.create();
    const history = memory.auditResearchMemory(query);
    if (history.length === 0) {
      console.log(`no ledger entries for ${query}`);
    }
    for (const entry of history) {
      const confidence =
        entry.newState?.confidence !== undefined
          ? ` confidence ${entry.previousState?.confidence ?? "-"} -> ${entry.newState.confidence}`
          : "";
      console.log(`- ${entry.action} by ${entry.actor} at ${new Date(entry.timestamp).toISOString()}${confidence}`);
    }
  }
} else if (command === "research") {
  const text = [query, ...extra].join(" ").trim();
  if (!text) {
    console.error('Usage: npx tsx research-os/research.ts research "<question>"');
    process.exitCode = 1;
  } else {
    try {
      loadResearchOsEnv();
      const { ResearchMemory } = await import("./src/memory/research-memory.ts");
      const { ResearchAgent } = await import("./src/agents/research-agent.ts");
      const { DeterministicResearchReasoner } = await import("./src/reasoning/deterministic-reasoner.ts");
      const agent = new ResearchAgent(
        await ResearchMemory.create(),
        ZetarisResearchRepository.fromEnv(),
        new DeterministicResearchReasoner(),
      );
      printResearchResult(await agent.research(text));
    } catch (error) {
      console.error(safeResearchFailure(error));
      process.exitCode = 1;
    }
  }
} else if (command === "memory") {
  const text = [query, ...extra].join(" ").trim();
  if (!text) {
    console.error('Usage: npx tsx research-os/research.ts memory "<query>"');
    process.exitCode = 1;
  } else {
    const { ResearchMemory } = await import("./src/memory/research-memory.ts");
    const memory = await ResearchMemory.create();
    const result = memory.retrieveResearchMemory(text);
    if (result.memories.length === 0) {
      console.log("no memories retrieved");
    }
    for (const hit of result.memories) {
      printRetrievedMemory(hit, result.trace);
    }
  }
} else {
  console.error('Usage: npx tsx research-os/research.ts search "<query>"');
  console.error("       npx tsx research-os/research.ts evidence <paperId>");
  console.error("       npx tsx research-os/research.ts schemes");
  console.error("       npx tsx research-os/research.ts evidence-conflicts");
  console.error("       npx tsx research-os/research.ts seed-memory");
  console.error("       npx tsx research-os/research.ts audit <memory-id>");
  console.error('       npx tsx research-os/research.ts research "<question>"');
  console.error('       npx tsx research-os/research.ts memory "<query>"');
  process.exitCode = 1;
}
