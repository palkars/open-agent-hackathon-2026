import type { ResearchMemory, ResearchMemoryInput, ResearchMemoryType } from "../memory/research-memory.ts";
import type { ResearchReasoner } from "../reasoning/types.ts";
import type { ZetarisResearchRepository } from "../zetaris/repository.ts";
import type { EvidenceAssessment, ResearchAgentResult, ResearchConclusion, ResearchContext } from "./types.ts";

const CONCLUSION_MEMORY_TYPE: Record<EvidenceAssessment, ResearchMemoryType> = {
  SUPPORTED: "CLAIM",
  CONTRADICTED: "CONTRADICTION",
  MIXED: "LIMITATION",
  INSUFFICIENT: "OPEN_QUESTION",
};

const CONCLUSION_TAGS = [
  "researchos",
  "agent-generated",
  "post-quantum",
  "anonymity",
  "traceability",
  "trusted-opener",
] as const;

export class ResearchAgent {
  constructor(
    private readonly memory: ResearchMemory,
    private readonly repository: ZetarisResearchRepository,
    private readonly reasoner: ResearchReasoner,
  ) {}

  async research(question: string): Promise<ResearchAgentResult> {
    const text = question.trim();
    if (!text) {
      throw new Error("Research question cannot be empty");
    }

    console.log("[ResearchOS] Question received");
    const context = await this.gatherResearchContext(text);
    console.log("[ResearchOS] Assessing evidence");
    const conclusion = await this.assessResearchContext(context);
    const stored = this.storeResearchConclusion(conclusion);
    if (stored.memoryStored) console.log("[Meterless H-MEM] Storing new research learning");
    else if (stored.storedMemoryId) console.log("[Meterless H-MEM] Research learning already stored");
    console.log("[ResearchOS] Complete");

    return {
      question: context.question,
      context,
      conclusion,
      memoryStored: stored.memoryStored,
      ...(stored.storedMemoryId ? { storedMemoryId: stored.storedMemoryId } : {}),
    };
  }

  async gatherResearchContext(question: string): Promise<ResearchContext> {
    const text = question.trim();
    if (!text) {
      throw new Error("Research question cannot be empty");
    }

    console.log("[Meterless H-MEM] Retrieving prior knowledge");
    const priorMemories = this.memory.retrieveResearchMemory(text);

    console.log("[Zetaris] Retrieving current evidence");
    const currentEvidence = await this.repository.findPostQuantumAnonymousTraceableSchemes();

    return {
      question: { question: text },
      priorMemories,
      currentEvidence,
    };
  }

  assessResearchContext(context: ResearchContext): Promise<ResearchConclusion> {
    return this.reasoner.assess(context);
  }

  storeResearchConclusion(conclusion: ResearchConclusion): Pick<ResearchAgentResult, "memoryStored" | "storedMemoryId"> {
    const finding: ResearchMemoryInput = {
      type: CONCLUSION_MEMORY_TYPE[conclusion.assessment],
      content: conclusion.summary,
      confidence: conclusion.confidence,
      sourceIds: sourceIds(conclusion),
      tags: [...CONCLUSION_TAGS],
    };

    const existing = this.memory.findResearchFinding(finding);
    if (existing) return { memoryStored: false, storedMemoryId: existing.id };

    try {
      const stored = this.memory.rememberResearchFinding(finding);
      const storedMemoryId = typeof stored.id === "string" ? stored.id.trim() : "";
      return storedMemoryId ? { memoryStored: true, storedMemoryId } : { memoryStored: true };
    } catch {
      return { memoryStored: false };
    }
  }
}

function sourceIds(conclusion: ResearchConclusion): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [...conclusion.supportingSourceIds, ...conclusion.conflictingSourceIds]) {
    const text = id.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    ids.push(text);
  }
  return ids;
}
