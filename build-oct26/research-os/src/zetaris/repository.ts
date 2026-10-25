import type { Experiment, Note, Paper } from "../data/repository.ts";
import type { CrossSourceRow, ResearchRepository } from "../data/research-repository.ts";
import { ZetarisClient, asBoolean, asNullableNumber, asNullableText, asNumber, asText, zetarisConfigFromEnv } from "./client.ts";

// Tables live as schema-store views in one container (see setup.ts), queried
// as <container>.<table>. Column order is fixed here because REST rows are
// positional.
export const PAPER_COLUMNS = [
  "paper_id", "title", "year", "topic", "method", "provides_anonymity", "provides_traceability",
  "post_quantum", "trusted_opener_required", "key_claim", "limitation",
] as const;
export const NOTE_COLUMNS = ["note_id", "date", "type", "text", "confidence"] as const;
export const NOTE_PAPER_COLUMNS = ["note_id", "paper_id"] as const;
export const EXPERIMENT_COLUMNS = [
  "experiment_id", "paper_id", "scheme", "security_level", "signature_size_bytes", "sign_time_ms", "verify_time_ms", "result",
] as const;

export function zetarisContainerFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const container = env.ZETARIS_RESEARCH_CONTAINER?.trim() || "researchos";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(container)) {
    throw new Error(`ZETARIS_RESEARCH_CONTAINER must be a plain identifier (got "${container}")`);
  }
  return container;
}

// The REST API has no bind parameters, so IDs are validated before they are
// placed in SQL text.
function idList(ids: string[]): string {
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid record id for a Zetaris query: ${JSON.stringify(id)}`);
  }
  return ids.map((id) => `'${id}'`).join(", ");
}

function select(columns: readonly string[], alias: string): string {
  return columns.map((column) => `${alias}.${column}`).join(", ");
}

export class ZetarisResearchRepository implements ResearchRepository {
  readonly source = "zetaris" as const;

  constructor(readonly client: ZetarisClient, readonly container: string) {}

  static fromEnv(): ZetarisResearchRepository {
    return new ZetarisResearchRepository(new ZetarisClient(zetarisConfigFromEnv()), zetarisContainerFromEnv());
  }

  private table(name: string): string {
    return `${this.container}.${name}`;
  }

  async searchPapers(query: string): Promise<Paper[]> {
    // Terms are reduced to [a-z0-9], so they are safe inside LIKE patterns.
    const terms = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    // Same text as the local search: every field name and value, lowercased,
    // with runs of other characters collapsed to one space.
    const fields = PAPER_COLUMNS.map((c) => `'${c}', CAST(p.${c} AS STRING)`).join(", ");
    const haystack = `regexp_replace(lower(concat_ws(' ', ${fields})), '[^a-z0-9]+', ' ')`;
    const where = terms.length > 0 ? `WHERE ${terms.map((term) => `${haystack} LIKE '%${term}%'`).join(" AND ")}` : "";
    const rows = await this.client.runSql(`SELECT ${select(PAPER_COLUMNS, "p")} FROM ${this.table("papers")} p ${where} ORDER BY p.paper_id`);
    return rows.map(toPaper);
  }

  async getPapers(paperIds: string[]): Promise<Paper[]> {
    if (paperIds.length === 0) return [];
    const rows = await this.client.runSql(
      `SELECT ${select(PAPER_COLUMNS, "p")} FROM ${this.table("papers")} p WHERE p.paper_id IN (${idList(paperIds)}) ORDER BY p.paper_id`,
    );
    return rows.map(toPaper);
  }

  async getNotes(paperIds?: string[]): Promise<Note[]> {
    if (paperIds?.length === 0) return [];
    let filter = "";
    if (paperIds) {
      // Spark can't resolve note_papers referenced twice in one statement when
      // the view is built on inline VALUES, so the citing notes come first.
      const citing = await this.client.runSql(
        `SELECT DISTINCT np.note_id FROM ${this.table("note_papers")} np WHERE np.paper_id IN (${idList(paperIds)})`,
      );
      const noteIds = citing.map((row) => asText(row[0]));
      if (noteIds.length === 0) return [];
      filter = `WHERE n.note_id IN (${idList(noteIds)})`;
    }
    const rows = await this.client.runSql(
      `SELECT ${select(NOTE_COLUMNS, "n")}, np.paper_id FROM ${this.table("notes")} n ` +
        `LEFT JOIN ${this.table("note_papers")} np ON n.note_id = np.note_id ${filter} ORDER BY n.note_id, np.paper_id`,
    );
    // One row per (note, cited paper); fold them back into notes.
    const notes = new Map<string, Note>();
    for (const row of rows) {
      const noteId = asText(row[0]);
      const note = notes.get(noteId) ?? {
        note_id: noteId,
        date: asText(row[1]),
        type: asText(row[2]),
        text: asText(row[3]),
        confidence: asNumber(row[4]),
        related_papers: [],
      };
      const paperId = asNullableText(row[5]);
      if (paperId) note.related_papers.push(paperId);
      notes.set(noteId, note);
    }
    return [...notes.values()];
  }

  async getExperiments(paperIds?: string[]): Promise<Experiment[]> {
    if (paperIds?.length === 0) return [];
    const filter = paperIds ? `WHERE e.paper_id IN (${idList(paperIds)})` : "";
    const rows = await this.client.runSql(
      `SELECT ${select(EXPERIMENT_COLUMNS, "e")} FROM ${this.table("experiments")} e ${filter} ORDER BY e.experiment_id`,
    );
    return rows.map((row) => ({
      experiment_id: asText(row[0]),
      paper_id: asText(row[1]),
      scheme: asText(row[2]),
      security_level: asNumber(row[3]),
      signature_size_bytes: asNumber(row[4]),
      sign_time_ms: asNumber(row[5]),
      verify_time_ms: asNumber(row[6]),
      result: asText(row[7]),
    }));
  }

  async findPostQuantumTraceableEvidence(): Promise<CrossSourceRow[]> {
    const rows = await this.client.runSql(crossSourceSql(this.container));
    return rows.map((row) => ({
      paperId: asText(row[0]),
      title: asText(row[1]),
      method: asText(row[2]),
      trustedOpenerRequired: asBoolean(row[3]),
      experimentId: asNullableText(row[4]),
      verifyTimeMs: asNullableNumber(row[5]),
      noteId: asNullableText(row[6]),
      noteText: asNullableText(row[7]),
    }));
  }
}

// Phase 13: one federated query across papers, experiments and notes.
export function crossSourceSql(container: string): string {
  return [
    "SELECT p.paper_id, p.title, p.method, p.trusted_opener_required, e.experiment_id, e.verify_time_ms, n.note_id, n.text",
    `FROM ${container}.papers p`,
    `LEFT JOIN ${container}.experiments e ON p.paper_id = e.paper_id`,
    `LEFT JOIN ${container}.note_papers np ON p.paper_id = np.paper_id`,
    `LEFT JOIN ${container}.notes n ON np.note_id = n.note_id`,
    "WHERE p.post_quantum = true AND p.provides_anonymity = true AND p.provides_traceability = true",
    "ORDER BY p.paper_id, e.experiment_id, n.note_id",
  ].join(" ");
}

function toPaper(row: unknown[]): Paper {
  return {
    paper_id: asText(row[0]),
    title: asText(row[1]),
    year: asNumber(row[2]),
    topic: asText(row[3]),
    method: asText(row[4]),
    provides_anonymity: asBoolean(row[5]),
    provides_traceability: asBoolean(row[6]),
    post_quantum: asBoolean(row[7]),
    trusted_opener_required: asBoolean(row[8]),
    key_claim: asText(row[9]),
    limitation: asText(row[10]),
  };
}
