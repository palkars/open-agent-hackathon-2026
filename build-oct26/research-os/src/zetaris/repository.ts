import { ZetarisClient } from "./client.ts";
import { ZetarisClientError, type ZetarisQueryResult } from "./types.ts";
import type { Experiment, Paper, ResearchEvidence, ResearchNote } from "../data/types.ts";

const PAPER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const PAPER_COLUMNS = `
  paper_id,
  title,
  crypto_family,
  crypto_method,
  key_claim,
  limitation,
  provides_anonymity,
  provides_traceability,
  trusted_opener_required
`;

const NOTE_COLUMNS = `
  note_id,
  paper_id,
  note,
  stance,
  confidence
`;

const EXPERIMENT_COLUMNS = `
  experiment_id,
  paper_id,
  scheme,
  verify_time_ms,
  signature_size_bytes,
  communication_kb,
  result
`;

export interface TraceableScheme {
  paper_id: string;
  title: string;
  crypto_method: string;
  scheme: string | null;
  post_quantum: true;
  provides_anonymity: true;
  provides_traceability: true;
  trusted_opener_required: boolean | null;
  verify_time_ms?: number;
  signature_size_bytes?: number;
  communication_kb?: number;
  result?: string;
  key_claim?: string;
  limitation?: string;
}

export interface PotentiallyConflictingEvidence {
  paper_id: string;
  title: string;
  key_claim?: string;
  trusted_opener_required: boolean | null;
  note_stance: string;
  note_confidence?: number;
  researcher_note: string;
  experiment_result?: string;
}

export class ZetarisResearchRepository {
  constructor(private readonly client: ZetarisClient) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ZetarisResearchRepository {
    return new ZetarisResearchRepository(ZetarisClient.fromEnv(env));
  }

  async getPaperEvidence(paperId: string): Promise<ResearchEvidence> {
    return loadPaperEvidence(this.client, paperId);
  }

  async findPostQuantumAnonymousTraceableSchemes(): Promise<TraceableScheme[]> {
    const result = await this.client.query(`
      SELECT
        p.paper_id,
        p.title,
        p.crypto_method,
        p.trusted_opener_required,
        p.key_claim,
        p.limitation,
        e.scheme,
        e.verify_time_ms,
        e.signature_size_bytes,
        e.communication_kb,
        e.result
      FROM research_os.papers AS p
      LEFT JOIN research_os.experiments AS e
        ON p.paper_id = e.paper_id
      WHERE p.crypto_family = 'post-quantum'
        AND p.provides_anonymity = 'True'
        AND p.provides_traceability = 'True'
        AND p.trusted_opener_required = 'False'
      ORDER BY CAST(e.verify_time_ms AS DOUBLE) ASC NULLS LAST, p.paper_id
    `);
    return records(result).map(toTraceableScheme);
  }

  async getSkepticalResearchNotes(): Promise<ResearchNote[]> {
    const result = await this.client.query(`
      SELECT ${NOTE_COLUMNS}
      FROM research_os.notes
      WHERE stance = 'SKEPTICAL'
      ORDER BY note_id
    `);
    return records(result).map(toNote);
  }

  async getPotentiallyConflictingEvidence(): Promise<PotentiallyConflictingEvidence[]> {
    const result = await this.client.query(`
      SELECT
        p.paper_id,
        p.title,
        p.key_claim,
        p.trusted_opener_required,
        n.stance AS note_stance,
        n.confidence AS note_confidence,
        n.note AS researcher_note,
        e.result AS experiment_result
      FROM research_os.papers AS p
      INNER JOIN research_os.notes AS n
        ON p.paper_id = n.paper_id
      LEFT JOIN research_os.experiments AS e
        ON p.paper_id = e.paper_id
      WHERE n.stance = 'SKEPTICAL'
      ORDER BY p.paper_id, n.note_id, e.experiment_id
    `);
    return records(result).map(toPotentiallyConflictingEvidence);
  }

  async getResearchEvidence(): Promise<ResearchEvidence> {
    const papers = await this.client.query(`
      SELECT ${PAPER_COLUMNS}
      FROM research_os.papers
      ORDER BY paper_id
    `);
    const notes = await this.client.query(`
      SELECT ${NOTE_COLUMNS}
      FROM research_os.notes
      ORDER BY note_id
    `);
    const experiments = await this.client.query(`
      SELECT ${EXPERIMENT_COLUMNS}
      FROM research_os.experiments
      ORDER BY experiment_id
    `);
    return {
      papers: records(papers).map(toPaper),
      notes: records(notes).map(toNote),
      experiments: records(experiments).map(toExperiment),
    };
  }
}

export async function getPaperEvidence(paperId: string): Promise<ResearchEvidence> {
  return ZetarisResearchRepository.fromEnv().getPaperEvidence(paperId);
}

export async function findPostQuantumAnonymousTraceableSchemes(): Promise<TraceableScheme[]> {
  return ZetarisResearchRepository.fromEnv().findPostQuantumAnonymousTraceableSchemes();
}

export async function getSkepticalResearchNotes(): Promise<ResearchNote[]> {
  return ZetarisResearchRepository.fromEnv().getSkepticalResearchNotes();
}

export async function getPotentiallyConflictingEvidence(): Promise<PotentiallyConflictingEvidence[]> {
  return ZetarisResearchRepository.fromEnv().getPotentiallyConflictingEvidence();
}

export async function getResearchEvidence(): Promise<ResearchEvidence> {
  return ZetarisResearchRepository.fromEnv().getResearchEvidence();
}

async function loadPaperEvidence(client: ZetarisClient, paperId: string): Promise<ResearchEvidence> {
  const id = paperIdLiteral(paperId);
  const papers = await client.query(`
    SELECT ${PAPER_COLUMNS}
    FROM research_os.papers
    WHERE paper_id = ${id}
    ORDER BY paper_id
  `);
  const notes = await client.query(`
    SELECT ${NOTE_COLUMNS}
    FROM research_os.notes
    WHERE paper_id = ${id}
    ORDER BY note_id
  `);
  const experiments = await client.query(`
    SELECT ${EXPERIMENT_COLUMNS}
    FROM research_os.experiments
    WHERE paper_id = ${id}
    ORDER BY experiment_id
  `);
  return {
    papers: records(papers).map(toPaper),
    notes: records(notes).map(toNote),
    experiments: records(experiments).map(toExperiment),
  };
}

function paperIdLiteral(paperId: string): string {
  const id = paperId.trim();
  if (!PAPER_ID_PATTERN.test(id)) {
    throw new ZetarisClientError(
      "query",
      "paperId must contain only letters, numbers, underscores, or hyphens.",
    );
  }
  return `'${id}'`;
}

function records(result: ZetarisQueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    result.columns.forEach((column, index) => {
      record[column.name] = row[index];
    });
    return record;
  });
}

function toPaper(row: Record<string, unknown>): Paper {
  return {
    paper_id: text(row.paper_id),
    title: text(row.title),
    crypto_family: optionalText(row.crypto_family),
    crypto_method: optionalText(row.crypto_method),
    key_claim: optionalText(row.key_claim),
    limitation: optionalText(row.limitation),
    post_quantum: text(row.crypto_family) === "post-quantum",
    provides_anonymity: flag(row.provides_anonymity),
    provides_traceability: flag(row.provides_traceability),
    trusted_opener_required: flagOrNull(row.trusted_opener_required),
  };
}

function toNote(row: Record<string, unknown>): ResearchNote {
  return {
    note_id: text(row.note_id),
    paper_id: optionalText(row.paper_id),
    text: text(row.note),
    type: optionalText(row.stance),
    confidence: optionalNumber(row.confidence),
  };
}

function toExperiment(row: Record<string, unknown>): Experiment {
  return {
    experiment_id: text(row.experiment_id),
    paper_id: text(row.paper_id),
    scheme: text(row.scheme),
    verify_time_ms: optionalNumber(row.verify_time_ms),
    signature_size_bytes: optionalNumber(row.signature_size_bytes),
    communication_kb: optionalNumber(row.communication_kb),
    result: optionalText(row.result),
  };
}

function toTraceableScheme(row: Record<string, unknown>): TraceableScheme {
  return {
    paper_id: text(row.paper_id),
    title: text(row.title),
    crypto_method: text(row.crypto_method),
    scheme: optionalText(row.scheme) ?? null,
    post_quantum: true,
    provides_anonymity: true,
    provides_traceability: true,
    trusted_opener_required: flagOrNull(row.trusted_opener_required),
    verify_time_ms: optionalNumber(row.verify_time_ms),
    signature_size_bytes: optionalNumber(row.signature_size_bytes),
    communication_kb: optionalNumber(row.communication_kb),
    result: optionalText(row.result),
    key_claim: optionalText(row.key_claim),
    limitation: optionalText(row.limitation),
  };
}

function toPotentiallyConflictingEvidence(row: Record<string, unknown>): PotentiallyConflictingEvidence {
  return {
    paper_id: text(row.paper_id),
    title: text(row.title),
    key_claim: optionalText(row.key_claim),
    trusted_opener_required: flagOrNull(row.trusted_opener_required),
    note_stance: text(row.note_stance),
    note_confidence: optionalNumber(row.note_confidence),
    researcher_note: text(row.researcher_note),
    experiment_result: optionalText(row.experiment_result),
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const rendered = String(value).trim();
  return rendered === "" ? undefined : rendered;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function flag(value: unknown): boolean | undefined {
  if (value === true || value === "True") return true;
  if (value === false || value === "False") return false;
  return undefined;
}

function flagOrNull(value: unknown): boolean | null {
  return flag(value) ?? null;
}
