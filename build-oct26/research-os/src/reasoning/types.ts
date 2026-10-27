import type { ResearchConclusion, ResearchContext } from "../agents/types.ts";

export interface ResearchReasoner {
  assess(context: ResearchContext): Promise<ResearchConclusion>;
}
