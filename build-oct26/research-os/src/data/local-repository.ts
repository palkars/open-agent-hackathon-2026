import { loadExperiments, loadNotes, loadPapers, searchPapers } from "./repository.ts";
import type { Experiment, Note, Paper } from "./repository.ts";
import type { CrossSourceRow, ResearchRepository } from "./research-repository.ts";

export class LocalResearchRepository implements ResearchRepository {
  readonly source = "local" as const;

  async searchPapers(query: string): Promise<Paper[]> {
    return searchPapers(query);
  }

  async getPapers(paperIds: string[]): Promise<Paper[]> {
    const wanted = new Set(paperIds);
    return loadPapers().filter((paper) => wanted.has(paper.paper_id));
  }

  async getNotes(paperIds?: string[]): Promise<Note[]> {
    const notes = loadNotes();
    if (!paperIds) return notes;
    const wanted = new Set(paperIds);
    return notes.filter((note) => note.related_papers.some((id) => wanted.has(id)));
  }

  async getExperiments(paperIds?: string[]): Promise<Experiment[]> {
    const experiments = loadExperiments();
    if (!paperIds) return experiments;
    const wanted = new Set(paperIds);
    return experiments.filter((experiment) => wanted.has(experiment.paper_id));
  }

  // Same join the Zetaris implementation sends as SQL.
  async findPostQuantumTraceableEvidence(): Promise<CrossSourceRow[]> {
    const experiments = loadExperiments().sort((a, b) => a.experiment_id.localeCompare(b.experiment_id));
    const notes = loadNotes().sort((a, b) => a.note_id.localeCompare(b.note_id));
    const rows: CrossSourceRow[] = [];
    const papers = loadPapers()
      .filter((p) => p.post_quantum && p.provides_anonymity && p.provides_traceability)
      .sort((a, b) => a.paper_id.localeCompare(b.paper_id));

    for (const paper of papers) {
      const paperExperiments: (Experiment | null)[] = experiments.filter((e) => e.paper_id === paper.paper_id);
      const paperNotes: (Note | null)[] = notes.filter((n) => n.related_papers.includes(paper.paper_id));
      for (const experiment of paperExperiments.length > 0 ? paperExperiments : [null]) {
        for (const note of paperNotes.length > 0 ? paperNotes : [null]) {
          rows.push({
            paperId: paper.paper_id,
            title: paper.title,
            method: paper.method,
            trustedOpenerRequired: paper.trusted_opener_required,
            experimentId: experiment?.experiment_id ?? null,
            verifyTimeMs: experiment?.verify_time_ms ?? null,
            noteId: note?.note_id ?? null,
            noteText: note?.text ?? null,
          });
        }
      }
    }
    return rows;
  }
}
