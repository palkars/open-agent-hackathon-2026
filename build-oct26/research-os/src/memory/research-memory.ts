import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "../../../src/engine.ts";
import type { QueryResult } from "../../../vendor/hmem/src/types.ts";

export interface ResearchFinding {
  type: string;
  content: string;
  sourceIds: string[];
  confidence: number;
  tags: string[];
}

export class ResearchMemory {
  private constructor(
    private readonly hmem: {
      add: (input: Record<string, unknown>) => { id: string };
      query: (query: string, opts?: { topN?: number; threshold?: number; chatId?: string }) => QueryResult;
    },
  ) {}

  static async create(): Promise<ResearchMemory> {
    const { HMEM } = await loadHMEM();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const persistDir = path.join(here, "..", "..", ".memory");
    return new ResearchMemory(new HMEM({ persistDir, actor: "research-os" }));
  }

  rememberResearchFinding(finding: ResearchFinding): { id: string } {
    const source = finding.sourceIds.join(", ");
    return this.hmem.add({
      content: finding.content,
      type: "factual",
      tags: [finding.type, ...finding.tags],
      confidence: finding.confidence,
      source,
      provenance: {
        origin: "document",
        learnedAt: Date.now(),
        label: finding.type,
        refs: finding.sourceIds,
      },
    });
  }

  retrieveResearchMemory(query: string): QueryResult {
    // query() defaults to threshold 0.35. This embedder scores the sample
    // finding near 0.15, so the default drops it. threshold 0 keeps the
    // ranked hits; relevance is still H-MEM's score.
    return this.hmem.query(query, { threshold: 0 });
  }
}
