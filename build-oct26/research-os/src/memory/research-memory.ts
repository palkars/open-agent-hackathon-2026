import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "../../../src/engine.ts";

export interface ResearchFinding {
  type: string;
  content: string;
  source: string;
}

export interface RetrievedResearchFinding extends ResearchFinding {
  memoryId: string;
  relevance: number;
}

export interface ResearchMemoryOptions {
  topN?: number;
  threshold?: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const persistDir = path.resolve(here, "..", "..", ".memory");

async function createMemory() {
  const { HMEM } = await loadHMEM();
  return new HMEM({ persistDir });
}

export async function rememberResearchFinding(
  finding: ResearchFinding,
): Promise<{ id: string; content: string; type: string; source: string }> {
  for (const field of ["type", "content", "source"] as const) {
    if (!finding[field]?.trim()) {
      throw new Error(`Research finding ${field} must not be empty`);
    }
  }

  const hmem = await createMemory();
  const record = hmem.add({
    content: finding.content.trim(),
    type: "factual",
    layer: "working",
    tags: ["research:finding", `research:type:${finding.type.trim()}`],
    source: finding.source.trim(),
    provenance: {
      origin: "manual",
      learnedAt: Date.now(),
      label: `Research ${finding.type.trim()} from ${finding.source.trim()}`,
      refs: [finding.source.trim()],
    },
  });

  return {
    id: record.id,
    content: record.content,
    type: finding.type.trim(),
    source: record.source,
  };
}

export async function retrieveResearchMemory(
  query: string,
  options: ResearchMemoryOptions = {},
): Promise<RetrievedResearchFinding[]> {
  if (!query.trim()) {
    throw new Error("Research memory query must not be empty");
  }

  const hmem = await createMemory();
  const result = hmem.query(query, {
    topN: options.topN,
    threshold: options.threshold ?? 0.1,
  });

  return result.memories
    .filter(({ memory }: { memory: { tags: string[] } }) => memory.tags.includes("research:finding"))
    .map(({ memory, relevance }: {
      memory: { id: string; content: string; source: string; tags: string[] };
      relevance: number;
    }) => {
      const typeTag = memory.tags.find((tag: string) => tag.startsWith("research:type:"));
      return {
        memoryId: memory.id,
        type: typeTag?.slice("research:type:".length) ?? "UNKNOWN",
        content: memory.content,
        source: memory.source,
        relevance,
      };
    });
}
