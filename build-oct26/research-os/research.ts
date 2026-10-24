import { searchPapers } from "./src/data/repository.ts";
import { ResearchMemory, seedResearchNotes } from "./src/memory/research-memory.ts";
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
} else if (command === "seed-memory") {
  const memory = await ResearchMemory.create();
  seedResearchNotes(memory);
} else if (command === "audit") {
  if (!query?.trim()) {
    console.error("Usage: npx tsx research-os/research.ts audit <memory-id>");
    process.exitCode = 1;
  } else {
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
} else if (command === "memory") {
  const text = [query, ...extra].join(" ").trim();
  if (!text) {
    console.error('Usage: npx tsx research-os/research.ts memory "<query>"');
    process.exitCode = 1;
  } else {
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
  console.error("       npx tsx research-os/research.ts seed-memory");
  console.error("       npx tsx research-os/research.ts audit <memory-id>");
  console.error('       npx tsx research-os/research.ts memory "<query>"');
  process.exitCode = 1;
}
