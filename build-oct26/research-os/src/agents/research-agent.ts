import type { ResearchMemory } from "../memory/research-memory.ts";
import type { ZetarisResearchRepository } from "../zetaris/repository.ts";
import type { ResearchContext } from "./types.ts";

export class ResearchAgent {
  constructor(
    private readonly memory: ResearchMemory,
    private readonly repository: ZetarisResearchRepository,
  ) {}

  async gatherResearchContext(question: string): Promise<ResearchContext> {
    const text = question.trim();
    if (!text) {
      throw new Error("Research question cannot be empty");
    }

    console.log("[ResearchAgent] Retrieving prior knowledge from Meterless H-MEM");
    const priorMemories = this.memory.retrieveResearchMemory(text);

    console.log("[ResearchAgent] Retrieving current evidence from Zetaris");
    const currentEvidence = await this.repository.findPostQuantumAnonymousTraceableSchemes();

    return {
      question: { question: text },
      priorMemories,
      currentEvidence,
    };
  }
}
