// Manual persistence check: `remember` and `ask` run as separate Node
// processes, so a hit from `ask` proves the finding survived on disk.
//
//   npx tsx research-os/test-memory.ts remember
//   npx tsx research-os/test-memory.ts ask "trusted opener"

import path from "node:path";
import { ResearchMemory } from "./src/memory/research-memory.ts";
import type { ResearchFinding } from "./src/memory/research-memory.ts";

function printFinding(finding: ResearchFinding): void {
  console.log(`  id:         ${finding.id}`);
  console.log(`  type:       ${finding.type}`);
  console.log(`  content:    ${finding.content}`);
  console.log(`  source:     ${finding.source}`);
  console.log(`  sourceIds:  ${JSON.stringify(finding.sourceIds)}`);
  console.log(`  confidence: ${finding.confidence}`);
  console.log(`  tags:       ${JSON.stringify(finding.tags)}`);
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const memory = await ResearchMemory.create();
  console.log(`engine source: ${memory.engineSource} | state: ${path.relative(process.cwd(), memory.dir)}`);

  if (mode === "remember") {
    const stored = memory.rememberResearchFinding({
      type: "CLAIM",
      content: "Traceable group signatures may require a trusted opening authority.",
      sourceIds: ["P001", "P002"],
      confidence: 0.72,
      tags: ["group-signatures", "traceability", "trusted-opener"],
    });
    console.log("stored:");
    printFinding(stored);
    console.log('\nnow, in a new process: npx tsx research-os/test-memory.ts ask "trusted opener"');
  } else if (mode === "ask" && rest.join(" ").trim()) {
    const query = rest.join(" ");
    const result = memory.retrieveResearchMemory(query);
    console.log(`query: ${query}`);
    console.log(`H-MEM matches: ${result.hmemMatches} | research findings: ${result.findings.length}`);
    for (const finding of result.findings) {
      console.log(`\nrelevance: ${finding.relevance.toFixed(4)}`);
      printFinding(finding);
    }
    if (result.findings.length === 0) {
      console.error("FAIL: no research findings retrieved");
      process.exitCode = 1;
    }
  } else {
    console.error('usage:\n  npx tsx research-os/test-memory.ts remember\n  npx tsx research-os/test-memory.ts ask "<query>"');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
