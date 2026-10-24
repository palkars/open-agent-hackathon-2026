import path from "node:path";
import { searchPapers } from "./src/data/repository.ts";
import { RESEARCH_MEMORY_DIR, ResearchMemory } from "./src/memory/research-memory.ts";
import type { ResearchFinding } from "./src/memory/research-memory.ts";
import { seedResearchNotes } from "./src/memory/seed.ts";

function printFinding(finding: ResearchFinding, heading: string): void {
  console.log(`${finding.id}  ${finding.type}  ${heading}`);
  console.log(`  ${finding.content}`);
  console.log(`  confidence: ${finding.confidence}`);
  const refs = finding.sourceIds.length > 0 ? ` (refs: ${finding.sourceIds.join(", ")})` : "";
  console.log(`  source: ${finding.source}${refs}`);
  if (finding.tags.length > 0) console.log(`  tags: ${finding.tags.join(", ")}`);
}

async function openMemory(): Promise<ResearchMemory> {
  const memory = await ResearchMemory.create();
  console.log(`engine source: ${memory.engineSource} | state: ${path.relative(process.cwd(), RESEARCH_MEMORY_DIR)}`);
  return memory;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const arg = rest.join(" ").trim();

  switch (command) {
    case "search": {
      if (!arg) return usage();
      for (const paper of searchPapers(arg)) {
        console.log(`${paper.paper_id}\n${paper.title}\n`);
      }
      break;
    }
    case "seed-memory": {
      const report = await seedResearchNotes(await openMemory());
      console.log(`processed: ${report.processed} | stored: ${report.stored} | skipped (already seeded): ${report.skipped} | failed: ${report.failed}`);
      if (report.storedIds.length > 0) console.log(`stored: ${report.storedIds.join(", ")}`);
      for (const failure of report.failures) console.error(`failed ${failure.noteId}: ${failure.error}`);
      if (report.failed > 0) process.exitCode = 1;
      break;
    }
    case "memory": {
      if (!arg) return usage();
      const result = (await openMemory()).retrieveResearchMemory(arg);
      if (result.findings.length === 0) console.log(`no research findings matched "${arg}"`);
      for (const finding of result.findings) {
        printFinding(finding, `relevance ${finding.relevance.toFixed(4)}`);
        console.log();
      }
      console.log(`trace: ${result.trace.retrievalReason} | strategy: ${result.trace.strategy}`);
      console.log(`H-MEM matches: ${result.hmemMatches} | research findings: ${result.findings.length}`);
      break;
    }
    case "audit": {
      if (!arg) return usage();
      // TrustLedgerService of the same persistent research-memory instance.
      const { current, history } = (await openMemory()).auditResearchMemory(arg);
      if (history.length === 0) throw new Error(`no ledger entries for ${arg} in research memory`);
      if (current) printFinding(current, "(current)");
      else console.log(`${arg}: not currently stored as a research finding`);
      console.log(`\nledger (${history.length} entries):`);
      for (const e of history) {
        const conf = e.newState?.confidence !== undefined ? ` confidence ${e.previousState?.confidence ?? "-"} -> ${e.newState.confidence}` : "";
        const details = e.details ? ` ${JSON.stringify(e.details)}` : "";
        console.log(`- ${e.action} by ${e.actor} at ${new Date(e.timestamp).toISOString()}${conf}${details}`);
      }
      break;
    }
    default:
      usage();
  }
}

function usage(): void {
  console.error(`usage:
  npx tsx research-os/research.ts search "<query>"     full-text search over papers
  npx tsx research-os/research.ts seed-memory          store every note as a research finding (H-MEM)
  npx tsx research-os/research.ts memory "<query>"     retrieve research findings
  npx tsx research-os/research.ts audit <memory-id>    trust-ledger history of one memory`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
