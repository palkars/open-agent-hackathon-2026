import type { Experiment, Note, Paper } from "./repository.ts";
import { LocalResearchRepository } from "./local-repository.ts";
import { ZetarisResearchRepository } from "../zetaris/repository.ts";

export type DataSourceName = "local" | "zetaris";

// One row of the Phase 13 cross-source query: LEFT JOIN semantics, so a paper
// with no experiment or no citing note still appears with nulls.
export interface CrossSourceRow {
  paperId: string;
  title: string;
  method: string;
  trustedOpenerRequired: boolean;
  experimentId: string | null;
  verifyTimeMs: number | null;
  noteId: string | null;
  noteText: string | null;
}

// The evidence side of ResearchOS ("what exists?"). Async because the Zetaris
// implementation is a network call; the local one simply resolves.
export interface ResearchRepository {
  readonly source: DataSourceName;
  searchPapers(query: string): Promise<Paper[]>;
  getPapers(paperIds: string[]): Promise<Paper[]>;
  // Notes citing any of the given papers; all notes when omitted.
  getNotes(paperIds?: string[]): Promise<Note[]>;
  // Experiments run on any of the given papers; all experiments when omitted.
  getExperiments(paperIds?: string[]): Promise<Experiment[]>;
  // Post-quantum schemes providing anonymity and traceability, with their
  // experiments and the researcher notes that cite them.
  findPostQuantumTraceableEvidence(): Promise<CrossSourceRow[]>;
}

export function dataSourceFromEnv(): DataSourceName {
  const value = (process.env.DATA_SOURCE ?? "local").trim().toLowerCase();
  if (value !== "local" && value !== "zetaris") {
    throw new Error(`DATA_SOURCE must be "local" or "zetaris" (got "${process.env.DATA_SOURCE}")`);
  }
  return value;
}

export function createResearchRepository(source: DataSourceName = dataSourceFromEnv()): ResearchRepository {
  return source === "zetaris" ? ZetarisResearchRepository.fromEnv() : new LocalResearchRepository();
}
