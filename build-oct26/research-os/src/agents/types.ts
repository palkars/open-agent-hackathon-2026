import type { QueryResult } from "../../../vendor/hmem/src/types.ts";
import type { ResearchEvidence } from "../data/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme } from "../zetaris/repository.ts";

export interface ResearchQuestion {
  question: string;
}

export interface ResearchContext {
  question: ResearchQuestion;
  priorMemories: QueryResult;
  currentEvidence: ResearchEvidence | TraceableScheme[] | PotentiallyConflictingEvidence[];
}

export type EvidenceAssessment = "SUPPORTED" | "CONTRADICTED" | "MIXED" | "INSUFFICIENT";

export interface ResearchConclusion {
  assessment: EvidenceAssessment;
  summary: string;
  confidence: number;
  supportingSourceIds: string[];
  conflictingSourceIds: string[];
  openQuestions: string[];
}

export interface ResearchTimings {
  memoryRetrievalMs: number;
  zetarisRetrievalMs: number;
  reasoningMs: number;
  memoryStoreMs: number;
  totalMs: number;
}

export interface ResearchAgentResult {
  question: ResearchQuestion;
  context: ResearchContext;
  conclusion: ResearchConclusion;
  memoryStored: boolean;
  storedMemoryId?: string;
  timings: ResearchTimings;
}
