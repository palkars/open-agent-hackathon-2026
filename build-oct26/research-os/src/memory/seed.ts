import { loadNotes } from "../data/repository.ts";
import type { Note } from "../data/repository.ts";
import { ResearchMemory } from "./research-memory.ts";
import type { ResearchMemoryInput, ResearchMemoryType } from "./types.ts";

const NOTE_TYPE_TO_RESEARCH_TYPE = new Map<string, ResearchMemoryType>([
  ["conclusion", "CLAIM"],
  ["research_question", "OPEN_QUESTION"],
  ["limitation", "LIMITATION"],
  ["contradiction", "CONTRADICTION"],
  ["evidence", "EVIDENCE"],
]);

export interface SeedReport {
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  storedIds: string[];
  failures: { noteId: string; error: string }[];
}

export function noteToResearchMemoryInput(note: Note): ResearchMemoryInput {
  return {
    // Unknown note types fall back to CLAIM; the note-type tag keeps the original.
    type: NOTE_TYPE_TO_RESEARCH_TYPE.get(note.type) ?? "CLAIM",
    content: note.text,
    sourceIds: note.related_papers,
    confidence: note.confidence,
    tags: [`note:${note.note_id}`, `note-type:${note.type}`, `note-date:${note.date}`],
  };
}

// H-MEM has no upsert, so every add mints a new memory. A note is skipped
// when the store already holds a finding tagged with its ID and the same text;
// a note whose text changed is stored again as a new memory.
export async function seedResearchNotes(memory?: ResearchMemory): Promise<SeedReport> {
  memory ??= await ResearchMemory.create();
  const existing = memory.listResearchFindings();
  const report: SeedReport = { processed: 0, stored: 0, skipped: 0, failed: 0, storedIds: [], failures: [] };

  for (const note of loadNotes()) {
    report.processed++;
    try {
      const input = noteToResearchMemoryInput(note);
      const noteTag = `note:${note.note_id}`;
      if (existing.some((finding) => finding.tags.includes(noteTag) && finding.content === input.content)) {
        report.skipped++;
        continue;
      }
      const stored = memory.rememberResearchFinding(input);
      report.stored++;
      report.storedIds.push(stored.id);
    } catch (error) {
      report.failed++;
      report.failures.push({ noteId: String(note?.note_id), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}
