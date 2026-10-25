import type { Experiment, Note, Paper } from "../data/repository.ts";
import type { CrossSourceRow, ResearchRepository } from "../data/research-repository.ts";
import type { ResearchFinding, ResearchMemory, ResearchMemoryResult } from "../memory/research-memory.ts";
import type { ToolDefinition } from "../llm/provider.ts";
import { ZetarisResearchRepository } from "../zetaris/repository.ts";

// The research agent's tools. The offline planner calls the typed methods in a
// fixed order; a model calls the same methods through call(). Everything a
// tool returns is recorded in the ledger, which is what evaluations may cite.

export interface ToolTraceEntry {
  iteration: number;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  error?: string;
}

export class EvidenceLedger {
  readonly papers = new Map<string, Paper>();
  readonly experiments = new Map<string, Experiment>();
  readonly notes = new Map<string, Note>();
  readonly memories = new Map<string, ResearchFinding>();
  // IDs seen only in raw run_sql rows.
  readonly sqlIds = new Set<string>();

  isGrounded(id: string): boolean {
    return this.papers.has(id) || this.experiments.has(id) || this.notes.has(id) || this.memories.has(id) || this.sqlIds.has(id);
  }
}

const STOPWORDS = new Set([
  "a", "an", "the", "can", "could", "be", "is", "are", "was", "were", "do", "does", "did", "with", "without", "of", "for",
  "to", "in", "on", "and", "or", "work", "works", "what", "which", "how", "we", "our", "it", "its", "that", "this", "there",
  "any", "by", "as", "at", "from", "about", "achieved", "achieve", "single", "one", "possible", "still", "need", "needs",
]);
const MAX_PAPERS_PER_SEARCH = 5;
const MAX_SQL_ROWS = 50;
const READ_ONLY_SQL = /^\s*(select|show|describe|with)\b/i;

export function searchTerms(query: string): string[] {
  const terms = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  return [...new Set(terms.filter((term) => term.length > 1 && !STOPWORDS.has(term)))];
}

export class ResearchTools {
  readonly ledger = new EvidenceLedger();
  readonly trace: ToolTraceEntry[] = [];
  iteration = 0;

  constructor(private readonly memory: ResearchMemory | undefined, readonly repository: ResearchRepository) {}

  get usesMemory(): boolean {
    return this.memory !== undefined;
  }

  // H-MEM retrieval, keeping its reinjection block for the chunk-0 prompt.
  async recall(query: string): Promise<ResearchMemoryResult> {
    const memory = this.requireMemory();
    return this.record("search_research_memory", { query }, async () => {
      const result = memory.retrieveResearchMemory(query);
      this.addMemories(result.findings);
      return { value: result, summary: result.findings.map((f) => `${f.id} ${f.type}`).join(", ") || "no findings" };
    });
  }

  async searchMemory(query: string): Promise<ResearchFinding[]> {
    return (await this.recall(query)).findings;
  }

  async memoriesCiting(sourceIds: string[]): Promise<ResearchFinding[]> {
    const memory = this.requireMemory();
    return this.record("find_memories_citing", { source_ids: sourceIds }, async () => {
      const findings = memory.findingsCiting(sourceIds);
      this.addMemories(findings);
      return { value: findings, summary: findings.map((f) => f.id).join(", ") || "none" };
    });
  }

  // Natural-language search: each meaningful term is searched on its own and
  // papers are ranked by how many terms they match.
  async searchPapers(query: string): Promise<Paper[]> {
    return this.record("search_papers", { query }, async () => {
      const hits = new Map<string, { paper: Paper; count: number }>();
      for (const term of searchTerms(query)) {
        for (const paper of await this.repository.searchPapers(term)) {
          const hit = hits.get(paper.paper_id) ?? { paper, count: 0 };
          hit.count++;
          hits.set(paper.paper_id, hit);
        }
      }
      const papers = [...hits.values()]
        .sort((a, b) => b.count - a.count || a.paper.paper_id.localeCompare(b.paper.paper_id))
        .slice(0, MAX_PAPERS_PER_SEARCH)
        .map((hit) => hit.paper);
      for (const paper of papers) this.ledger.papers.set(paper.paper_id, paper);
      return { value: papers, summary: papers.map((p) => p.paper_id).join(", ") || "no papers" };
    });
  }

  async getPapers(paperIds: string[]): Promise<Paper[]> {
    return this.record("get_papers", { paper_ids: paperIds }, async () => {
      const papers = await this.repository.getPapers(paperIds);
      for (const paper of papers) this.ledger.papers.set(paper.paper_id, paper);
      return { value: papers, summary: papers.map((p) => p.paper_id).join(", ") || "none" };
    });
  }

  async getExperiments(paperIds: string[]): Promise<Experiment[]> {
    return this.record("get_experiments", { paper_ids: paperIds }, async () => {
      const experiments = await this.repository.getExperiments(paperIds);
      for (const e of experiments) this.ledger.experiments.set(e.experiment_id, e);
      return { value: experiments, summary: experiments.map((e) => `${e.experiment_id} ${e.result}`).join(", ") || "none" };
    });
  }

  async getNotes(paperIds: string[]): Promise<Note[]> {
    return this.record("get_notes", { paper_ids: paperIds }, async () => {
      const notes = await this.repository.getNotes(paperIds);
      for (const n of notes) this.ledger.notes.set(n.note_id, n);
      return { value: notes, summary: notes.map((n) => n.note_id).join(", ") || "none" };
    });
  }

  // Phase 13 cross-source query; the joined papers, experiments and notes are
  // loaded in full so evaluations can use every field.
  async crossSource(): Promise<CrossSourceRow[]> {
    return this.record("post_quantum_traceable_evidence", {}, async () => {
      const rows = await this.repository.findPostQuantumTraceableEvidence();
      const paperIds = [...new Set(rows.map((r) => r.paperId))];
      if (paperIds.length > 0) {
        for (const paper of await this.repository.getPapers(paperIds)) this.ledger.papers.set(paper.paper_id, paper);
        for (const e of await this.repository.getExperiments(paperIds)) this.ledger.experiments.set(e.experiment_id, e);
        for (const n of await this.repository.getNotes(paperIds)) this.ledger.notes.set(n.note_id, n);
      }
      return { value: rows, summary: `${rows.length} rows over ${paperIds.join(", ") || "no papers"}` };
    });
  }

  async runSql(sql: string): Promise<unknown[][]> {
    const repository = this.repository;
    return this.record("run_sql", { sql }, async () => {
      if (!(repository instanceof ZetarisResearchRepository)) throw new Error("run_sql needs DATA_SOURCE=zetaris");
      if (!READ_ONLY_SQL.test(sql) || /;\s*\S/.test(sql)) throw new Error("run_sql accepts one read-only SELECT, SHOW, DESCRIBE or WITH statement");
      const rows = await repository.client.runSql(sql, MAX_SQL_ROWS);
      for (const value of rows.flat()) {
        if (typeof value === "string" && /^[PEN]\d{3,}$/.test(value)) this.ledger.sqlIds.add(value);
      }
      return { value: rows, summary: `${rows.length} rows` };
    });
  }

  definitions(): ToolDefinition[] {
    const ids = (description: string) => ({
      type: "object",
      properties: { paper_ids: { type: "array", items: { type: "string" }, description } },
      required: ["paper_ids"],
    });
    const tools: ToolDefinition[] = [];
    const add = (name: string, description: string, parameters: Record<string, unknown>) =>
      tools.push({ type: "function", function: { name, description, parameters } });

    if (this.memory) {
      add("search_research_memory", "Search H-MEM research memory: the researcher's prior claims, limitations and open questions, with memory IDs (mem-N), confidence and cited sources.", {
        type: "object", properties: { query: { type: "string" } }, required: ["query"],
      });
      add("find_memories_citing", "Find research memories whose provenance cites any of these paper or experiment IDs.", {
        type: "object", properties: { source_ids: { type: "array", items: { type: "string" } } }, required: ["source_ids"],
      });
    }
    add("search_papers", "Search research papers by natural-language query. Returns full paper records.", {
      type: "object", properties: { query: { type: "string" } }, required: ["query"],
    });
    add("get_papers", "Fetch papers by ID.", ids("Paper IDs such as P007"));
    add("get_experiments", "Fetch the experiments run on these papers (scheme, sizes, timings, PASS/FAIL).", ids("Paper IDs"));
    add("get_notes", "Fetch the researcher notes that cite these papers.", ids("Paper IDs"));
    add("post_quantum_traceable_evidence", "Cross-source query: post-quantum schemes with anonymity and traceability, joined with their experiments and citing notes.", {
      type: "object", properties: {},
    });
    if (this.repository instanceof ZetarisResearchRepository) {
      add("run_sql", `Run one read-only Lightning SQL statement on Zetaris. Tables: ${this.repository.container}.papers, .notes, .note_papers, .experiments.`, {
        type: "object", properties: { sql: { type: "string" } }, required: ["sql"],
      });
    }
    return tools;
  }

  // Model-facing entry point: never throws, so a bad call becomes a tool
  // error the model can read and correct.
  async call(name: string, rawArgs: string): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return JSON.stringify({ error: `arguments for ${name} are not valid JSON` });
    }
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
    try {
      switch (name) {
        case "search_research_memory":
          return JSON.stringify((await this.searchMemory(String(args.query ?? ""))).map(memoryView));
        case "find_memories_citing":
          return JSON.stringify((await this.memoriesCiting(strings(args.source_ids))).map(memoryView));
        case "search_papers":
          return JSON.stringify(await this.searchPapers(String(args.query ?? "")));
        case "get_papers":
          return JSON.stringify(await this.getPapers(strings(args.paper_ids)));
        case "get_experiments":
          return JSON.stringify(await this.getExperiments(strings(args.paper_ids)));
        case "get_notes":
          return JSON.stringify(await this.getNotes(strings(args.paper_ids)));
        case "post_quantum_traceable_evidence":
          return JSON.stringify(await this.crossSource());
        case "run_sql":
          return JSON.stringify(await this.runSql(String(args.sql ?? "")));
        default:
          this.trace.push({ iteration: this.iteration, tool: name, args, summary: "", error: "unknown tool" });
          return JSON.stringify({ error: `unknown tool ${name}` });
      }
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private requireMemory(): ResearchMemory {
    if (!this.memory) throw new Error("research memory is disabled for this run");
    return this.memory;
  }

  private addMemories(findings: ResearchFinding[]): void {
    for (const finding of findings) this.ledger.memories.set(finding.id, finding);
  }

  private async record<T>(tool: string, args: Record<string, unknown>, run: () => Promise<{ value: T; summary: string }>): Promise<T> {
    try {
      const { value, summary } = await run();
      this.trace.push({ iteration: this.iteration, tool, args, summary });
      return value;
    } catch (error) {
      this.trace.push({ iteration: this.iteration, tool, args, summary: "", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

function memoryView(finding: ResearchFinding) {
  const { id, type, content, confidence, sourceIds, supersededBy } = finding;
  return { id, type, content, confidence, sourceIds, ...(supersededBy ? { supersededBy } : {}) };
}
