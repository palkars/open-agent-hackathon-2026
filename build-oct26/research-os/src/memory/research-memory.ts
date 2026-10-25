import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "../../../src/engine.ts";
import type { HMEM, HMEMOptions, LedgerEntry, MemoryRecord, QueryResult, RetrievedMemory } from "../../../vendor/hmem/src/index.ts";
import { RESERVED_TAG_PREFIX, isResearchMemoryType, validateResearchMemoryInput } from "./types.ts";
import type { ResearchMemoryInput, ResearchMemoryType } from "./types.ts";

export const DEFAULT_RESEARCH_MEMORY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".memory");

const ACTOR = "research-os";
const FINDING_TAG = `${RESERVED_TAG_PREFIX}finding`;
const TYPE_TAG_PREFIX = `${RESERVED_TAG_PREFIX}type:`;
const UNSOURCED = "research-os:unsourced";

// H-MEM multiplies the hybrid score by confidence before applying its 0.35
// default threshold, which hides most findings below ~0.7 confidence. The
// notebook's `ask` uses 0.1 for the same reason.
const DEFAULT_TOP_N = 5;
const DEFAULT_THRESHOLD = 0.1;

// RESEARCH_OS_MEMORY_DIR points ResearchOS at another H-MEM store, e.g. a
// fresh one for a demo or a test.
export function researchMemoryDir(): string {
  const override = process.env.RESEARCH_OS_MEMORY_DIR?.trim();
  return override ? path.resolve(override) : DEFAULT_RESEARCH_MEMORY_DIR;
}

export interface ResearchFinding {
  id: string;
  type: ResearchMemoryType;
  content: string;
  confidence: number;
  source: string;
  sourceIds: string[];
  tags: string[];
  supersedes?: string;
  supersededBy?: string;
}

export interface RetrievedResearchFinding extends ResearchFinding {
  relevance: number;
}

export interface ResearchMemoryOptions {
  topN?: number;
  threshold?: number;
}

export interface ResearchMemoryResult {
  findings: RetrievedResearchFinding[];
  // H-MEM's reinjection block for the returned findings, ready for a prompt.
  context: string;
  trace: QueryResult["trace"];
  hmemMatches: number;
}

export interface ResearchMemoryAudit {
  current?: ResearchFinding;
  history: LedgerEntry[];
}

export class ResearchMemory {
  private constructor(private readonly hmem: HMEM, readonly engineSource: string, readonly dir: string) {}

  static async create(dir: string = researchMemoryDir()): Promise<ResearchMemory> {
    const { HMEM, source } = await loadHMEM();
    const options: HMEMOptions = { persistDir: dir, actor: ACTOR };
    return new ResearchMemory(new HMEM(options), source, dir);
  }

  rememberResearchFinding(input: ResearchMemoryInput): ResearchFinding {
    return this.add(validateResearchMemoryInput(input));
  }

  // Stores a conclusion that replaces earlier ones. The old records are kept
  // and marked supersededBy (H-MEM penalises them in ranking, never deletes),
  // and each change lands in the trust ledger.
  reviseResearchFindings(supersededIds: string[], input: ResearchMemoryInput): ResearchFinding {
    const finding = validateResearchMemoryInput(input);
    for (const id of supersededIds) this.mustGetFinding(id);
    const stored = this.add(finding, supersededIds[0]);
    for (const id of supersededIds) this.hmem.store.update(id, { supersededBy: stored.id });
    return stored;
  }

  // Evidence-vs-memory conflicts come from the research agent, not from H-MEM's
  // memory-vs-memory scan, so they are written to the ledger directly.
  recordConflict(memoryId: string, details: { evidence: string[]; reason: string; confidence: number }): void {
    this.mustGetFinding(memoryId);
    this.hmem.ledger.log(memoryId, "conflict_detected", ACTOR, { details: { ...details, detectedBy: "research-agent" } });
  }

  // H-MEM's feedback path: +0.05 confidence and one access, logged.
  markHelpful(memoryId: string): void {
    this.mustGetFinding(memoryId);
    this.hmem.feedback(memoryId, "helpful");
  }

  retrieveResearchMemory(query: string, options: ResearchMemoryOptions = {}): ResearchMemoryResult {
    if (query.trim() === "") throw new Error("research memory query must not be empty");
    const topN = options.topN ?? DEFAULT_TOP_N;
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    if (!Number.isInteger(topN) || topN < 1) throw new Error(`topN must be a positive integer (got ${topN})`);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`threshold must be between 0 and 1 (got ${threshold})`);
    }

    // The filter runs after H-MEM's top-N cut; this persist directory holds
    // only research findings, so nothing else should compete for those slots.
    const result = this.hmem.query(query, { topN, threshold });
    const findings: RetrievedResearchFinding[] = [];
    const research: RetrievedMemory[] = [];
    for (const item of result.memories) {
      const finding = toFinding(item.memory);
      if (!finding) continue;
      findings.push({ ...finding, relevance: item.relevance });
      research.push(item);
    }
    return {
      findings,
      context: this.hmem.retrieval.formatReinjection(research),
      trace: result.trace,
      hmemMatches: result.memories.length,
    };
  }

  // Reads the store directly, so unlike retrieval it writes no ledger entries.
  listResearchFindings(): ResearchFinding[] {
    return this.hmem.store
      .all()
      .flatMap((record) => toFinding(record) ?? [])
      .sort((a, b) => memoryOrder(a.id) - memoryOrder(b.id));
  }

  // Findings whose provenance cites any of the given evidence IDs.
  findingsCiting(sourceIds: string[]): ResearchFinding[] {
    const wanted = new Set(sourceIds);
    return this.listResearchFindings().filter((finding) => finding.sourceIds.some((id) => wanted.has(id)));
  }

  auditResearchMemory(id: string): ResearchMemoryAudit {
    const record = this.hmem.store.get(id);
    return { current: record && toFinding(record), history: this.hmem.ledger.history(id) };
  }

  private add(finding: ResearchMemoryInput, supersedes?: string): ResearchFinding {
    const record = this.hmem.add({
      content: finding.content,
      type: "factual",
      tags: [FINDING_TAG, `${TYPE_TAG_PREFIX}${finding.type}`, ...finding.tags],
      confidence: finding.confidence,
      // H-MEM requires one non-empty source string; refs keep the individual IDs.
      source: finding.sourceIds.length > 0 ? `research-os:${finding.sourceIds.join(",")}` : UNSOURCED,
      provenance: {
        origin: "document",
        learnedAt: this.hmem.clock(),
        label: finding.type,
        refs: finding.sourceIds,
      },
      supersedes,
    });
    const stored = toFinding(record);
    if (!stored) throw new Error(`H-MEM did not keep the research tags on ${record.id}`);
    return stored;
  }

  private mustGetFinding(id: string): ResearchFinding {
    const record = this.hmem.store.get(id);
    const finding = record && toFinding(record);
    if (!finding) throw new Error(`${id} is not a research finding in ${this.dir}`);
    return finding;
  }
}

function memoryOrder(id: string): number {
  return Number(id.replace(/^mem-/, "")) || 0;
}

function toFinding(record: MemoryRecord): ResearchFinding | undefined {
  if (!record.tags.includes(FINDING_TAG)) return undefined;
  const type = record.tags.find((tag) => tag.startsWith(TYPE_TAG_PREFIX))?.slice(TYPE_TAG_PREFIX.length);
  if (!isResearchMemoryType(type)) return undefined;
  return {
    id: record.id,
    type,
    content: record.content,
    confidence: record.confidence,
    source: record.source,
    sourceIds: [...(record.provenance?.refs ?? [])],
    tags: record.tags.filter((tag) => !tag.startsWith(RESERVED_TAG_PREFIX)),
    ...(record.supersedes ? { supersedes: record.supersedes } : {}),
    ...(record.supersededBy ? { supersededBy: record.supersededBy } : {}),
  };
}
