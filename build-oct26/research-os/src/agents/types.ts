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
  chunkPrompt?: string;
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

export type EvidenceRelationship = "SUPPORTS" | "CONTRADICTS" | "EXTENDS" | "UNRELATED";

export interface ContradictionReport {
  relationship: EvidenceRelationship;
  memoryId: string;
  evidence: string[];
  confidence: number;
  reason: string;
  recommendation: string;
}

export interface ResearchTimings {
  memoryRetrievalMs: number;
  zetarisRetrievalMs: number;
  reasoningMs: number;
  evaluationMs: number;
  memoryStoreMs: number;
  totalMs: number;
}

export const MAX_RESEARCH_ITERATIONS = 3;

export type ResearchTraceStep = "Search memory" | "Query Zetaris" | "Found conflict" | "No conflict" | "Investigate" | "Conclusion";

export interface ResearchTraceEntry {
  iteration: number;
  step: ResearchTraceStep;
  detail: string;
}

export interface MarkovianTrace {
  chunks: number;
  status: string;
  resolved: string[];
}

export interface ResearchAgentResult {
  question: ResearchQuestion;
  context: ResearchContext;
  conclusion: ResearchConclusion;
  evaluations: ContradictionReport[];
  iterations: number;
  trace: ResearchTraceEntry[];
  markovian: MarkovianTrace;
  memoryStored: boolean;
  storedMemoryId?: string;
  timings: ResearchTimings;
}
