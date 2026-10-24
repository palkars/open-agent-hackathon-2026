import { ResearchMemory } from "./src/memory/research-memory.ts";

const memory = await ResearchMemory.create();

memory.rememberResearchFinding({
  type: "CLAIM",
  content: "Traceable group signatures may require a trusted opening authority.",
  sourceIds: ["P001", "P002"],
  confidence: 0.72,
  tags: ["group-signatures", "traceability", "trusted-opener"],
});

console.log("rememberResearchFinding completed");
