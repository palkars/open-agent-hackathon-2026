import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "../../../src/engine.ts";
import type { LedgerEntry, QueryResult } from "../../../vendor/hmem/src/types.ts";
import { loadNotes, type Note } from "../data/repository.ts";

const RESEARCH_MEMORY_TYPES = [
  "CLAIM",
  "EVIDENCE",
  "LIMITATION",
  "CONTRADICTION",
  "OPEN_QUESTION",
  "RESEARCH_DIRECTION",
] as const;

export type ResearchMemoryType = (typeof RESEARCH_MEMORY_TYPES)[number];

export interface ResearchMemoryInput {
  type: ResearchMemoryType;
  content: string;
  sourceIds: string[];
  confidence: number;
  tags: string[];
}

export type ResearchFinding = ResearchMemoryInput;

function isResearchMemoryType(value: string): value is ResearchMemoryType {
  return (RESEARCH_MEMORY_TYPES as readonly string[]).includes(value);
}

export function toResearchMemoryInput(note: Note): ResearchMemoryInput {
  const stance = note.stance?.trim().toUpperCase() ?? "";
  const noteType = note.note_type?.trim().toUpperCase() ?? "";
  const type = isResearchMemoryType(stance) ? stance : isResearchMemoryType(noteType) ? noteType : "CLAIM";
  return {
    type,
    content: note.note,
    confidence: note.confidence,
    sourceIds: note.paper_id ? [note.paper_id] : [],
    tags: note.tags ?? [],
  };
}

export class ResearchMemory {
  private constructor(
    private readonly hmem: {
      add: (input: Record<string, unknown>) => { id: string };
      query: (query: string, opts?: { topN?: number; threshold?: number; chatId?: string }) => QueryResult;
      store: { all: () => { id?: string; content: string; source: string }[] };
      ledger: { history: (memoryId: string) => LedgerEntry[] };
    },
  ) {}

  static async create(): Promise<ResearchMemory> {
    const { HMEM } = await loadHMEM();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const persistDir = path.join(here, "..", "..", ".memory");
    return new ResearchMemory(new HMEM({ persistDir, actor: "research-os" }));
  }

  rememberResearchFinding(finding: ResearchMemoryInput): { id: string } {
    const source = finding.sourceIds.join(", ");
    return this.hmem.add({
      content: finding.content,
      type: "factual",
      tags: [finding.type, ...finding.tags],
      confidence: finding.confidence,
      source,
      provenance: {
        origin: "document",
        learnedAt: Date.now(),
        label: finding.type,
        refs: finding.sourceIds,
      },
    });
  }

  findResearchFinding(finding: ResearchMemoryInput): { id: string } | undefined {
    const source = finding.sourceIds.join(", ");
    const match = this.hmem.store.all().find((record) => record.content === finding.content && record.source === source);
    const id = match?.id?.trim();
    return id ? { id } : undefined;
  }

  hasResearchFinding(finding: ResearchMemoryInput): boolean {
    const source = finding.sourceIds.join(", ");
    return this.hmem.store.all().some((record) => record.content === finding.content && record.source === source);
  }

  auditResearchMemory(memoryId: string): LedgerEntry[] {
    return this.hmem.ledger.history(memoryId);
  }

  retrieveResearchMemory(query: string): QueryResult {
    // query() defaults to threshold 0.35. This embedder scores the sample
    // finding near 0.15, so the default drops it. threshold 0 keeps the
    // ranked hits; relevance is still H-MEM's score.
    return this.hmem.query(query, { threshold: 0 });
  }
}

export function seedResearchNotes(memory: ResearchMemory): { processed: number; stored: number; failed: number } {
  const notes = loadNotes();
  let stored = 0;
  let failed = 0;

  for (const note of notes) {
    try {
      const input = toResearchMemoryInput(note);
      if (!input.content.trim() || input.sourceIds.length === 0) {
        failed += 1;
        continue;
      }
      if (!memory.hasResearchFinding(input)) {
        memory.rememberResearchFinding(input);
      }
      stored += 1;
    } catch {
      failed += 1;
    }
  }

  const processed = notes.length;
  console.log(`processed: ${processed}`);
  console.log(`stored: ${stored}`);
  console.log(`failed: ${failed}`);
  return { processed, stored, failed };
}
