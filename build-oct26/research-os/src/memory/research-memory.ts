import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "../../../src/engine.ts";
import type { HMEM, HMEMOptions, LedgerEntry, MemoryRecord, QueryResult } from "../../../vendor/hmem/src/index.ts";
import { RESERVED_TAG_PREFIX, isResearchMemoryType, validateResearchMemoryInput } from "./types.ts";
import type { ResearchMemoryInput, ResearchMemoryType } from "./types.ts";

export const RESEARCH_MEMORY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".memory");

const FINDING_TAG = `${RESERVED_TAG_PREFIX}finding`;
const TYPE_TAG_PREFIX = `${RESERVED_TAG_PREFIX}type:`;
const UNSOURCED = "research-os:unsourced";

// H-MEM multiplies the hybrid score by confidence before applying its 0.35
// default threshold, which hides most findings below ~0.7 confidence. The
// notebook's `ask` uses 0.1 for the same reason.
const DEFAULT_TOP_N = 5;
const DEFAULT_THRESHOLD = 0.1;

export interface ResearchFinding {
  id: string;
  type: ResearchMemoryType;
  content: string;
  confidence: number;
  source: string;
  sourceIds: string[];
  tags: string[];
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
  trace: QueryResult["trace"];
  hmemMatches: number;
}

export interface ResearchMemoryAudit {
  current?: ResearchFinding;
  history: LedgerEntry[];
}

export class ResearchMemory {
  private constructor(private readonly hmem: HMEM, readonly engineSource: string) {}

  static async create(): Promise<ResearchMemory> {
    const { HMEM, source } = await loadHMEM();
    const options: HMEMOptions = { persistDir: RESEARCH_MEMORY_DIR, actor: "research-os" };
    return new ResearchMemory(new HMEM(options), source);
  }

  rememberResearchFinding(input: ResearchMemoryInput): ResearchFinding {
    const finding = validateResearchMemoryInput(input);
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
    });
    const stored = toFinding(record);
    if (!stored) throw new Error(`H-MEM did not keep the research tags on ${record.id}`);
    return stored;
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
    for (const { memory, relevance } of result.memories) {
      const finding = toFinding(memory);
      if (finding) findings.push({ ...finding, relevance });
    }
    return { findings, trace: result.trace, hmemMatches: result.memories.length };
  }

  // Reads the store directly, so unlike retrieval it writes no ledger entries.
  listResearchFindings(): ResearchFinding[] {
    return this.hmem.store.all().flatMap((record) => toFinding(record) ?? []);
  }

  auditResearchMemory(id: string): ResearchMemoryAudit {
    const record = this.hmem.store.get(id);
    return { current: record && toFinding(record), history: this.hmem.ledger.history(id) };
  }
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
  };
}
