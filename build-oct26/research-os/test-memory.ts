import { ResearchMemory } from "./src/memory/research-memory.ts";

const finding = {
  type: "CLAIM",
  content: "Traceable group signatures may require a trusted opening authority.",
  sourceIds: ["P001", "P002"],
  confidence: 0.72,
  tags: ["group-signatures", "traceability", "trusted-opener"],
};

const [command, ...rest] = process.argv.slice(2);
const query = rest.join(" ").trim();
const memory = await ResearchMemory.create();

if (command === "remember") {
  memory.rememberResearchFinding(finding);
  console.log("rememberResearchFinding completed");
} else if (command === "ask") {
  if (!query) {
    console.error('Usage: npx tsx research-os/test-memory.ts ask "<query>"');
    process.exitCode = 1;
  } else {
    const result = memory.retrieveResearchMemory(query);
    if (result.memories.length === 0) {
      console.log("no memories retrieved");
    }
    for (const hit of result.memories) {
      const record = hit.memory;
      console.log(record.content);
      console.log(`relevance: ${hit.relevance}`);
      if (record.score !== undefined) console.log(`score: ${record.score}`);
      console.log(`id: ${record.id}`);
      console.log(`source: ${record.source}`);
      console.log(`provenance: ${JSON.stringify(record.provenance)}`);
      console.log("");
    }
  }
} else {
  console.error("Usage: npx tsx research-os/test-memory.ts remember | ask \"<query>\"");
  process.exitCode = 1;
}
