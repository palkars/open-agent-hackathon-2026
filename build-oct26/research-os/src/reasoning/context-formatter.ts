import type { ResearchContext } from "../agents/types.ts";
import type { Experiment, Paper, ResearchNote } from "../data/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme } from "../zetaris/repository.ts";

export function formatResearchContext(context: ResearchContext): string {
  const sections = [
    "RESEARCH QUESTION",
    text(context.question.question) ?? "none",
    "",
    "PRIOR RESEARCH MEMORY",
    formatMemories(context),
    "",
    "CURRENT RESEARCH EVIDENCE",
    formatEvidence(context.currentEvidence),
  ];
  if (!context.chunkPrompt) return sections.join("\n");
  return ["MARKOVIAN CHUNK", context.chunkPrompt, "", ...sections].join("\n");
}

function formatMemories(context: ResearchContext): string {
  const memories = context.priorMemories.memories;
  if (memories.length === 0) return "none";
  return memories.map((hit) => {
    const record = hit.memory;
    const refs = record.provenance?.refs?.map((ref) => ref.trim()).filter(Boolean) ?? [];
    return block([
      field("type", text(record.provenance?.label) ?? text(record.type)),
      field("content", record.content),
      field("confidence", record.confidence),
      field("source IDs", refs.length > 0 ? refs.join(", ") : text(record.source)),
    ]);
  }).join("\n\n");
}

function formatEvidence(evidence: ResearchContext["currentEvidence"]): string {
  if (Array.isArray(evidence)) {
    if (evidence.length === 0) return "none";
    return evidence.map((row) => ("researcher_note" in row ? formatConflict(row) : formatScheme(row))).join("\n\n");
  }
  const blocks = [
    ...evidence.papers.map(formatPaper),
    ...evidence.notes.map(formatNote),
    ...evidence.experiments.map(formatExperiment),
  ];
  return blocks.length > 0 ? blocks.join("\n\n") : "none";
}

function formatScheme(scheme: TraceableScheme): string {
  return block([
    field("paper ID", scheme.paper_id),
    field("title", scheme.title),
    field("crypto method", scheme.crypto_method),
    field("anonymity", scheme.provides_anonymity),
    field("traceability", scheme.provides_traceability),
    field("trusted opener required", scheme.trusted_opener_required),
    field("claim", scheme.key_claim),
    field("limitation", scheme.limitation),
    field("experiment details", experimentDetails([
      detail("scheme", scheme.scheme),
      detail("verify_time_ms", scheme.verify_time_ms),
      detail("signature_size_bytes", scheme.signature_size_bytes),
      detail("communication_kb", scheme.communication_kb),
    ])),
    field("experiment result", scheme.result),
  ]);
}

function formatConflict(row: PotentiallyConflictingEvidence): string {
  return block([
    field("paper ID", row.paper_id),
    field("title", row.title),
    field("trusted opener required", row.trusted_opener_required),
    field("claim", row.key_claim),
    field("researcher note", row.researcher_note),
    field("note stance", row.note_stance),
    field("experiment result", row.experiment_result),
  ]);
}

function formatPaper(paper: Paper): string {
  return block([
    field("paper ID", paper.paper_id),
    field("title", paper.title),
    field("crypto method", paper.crypto_method),
    field("anonymity", paper.provides_anonymity),
    field("traceability", paper.provides_traceability),
    field("trusted opener required", paper.trusted_opener_required),
    field("claim", paper.key_claim),
    field("limitation", paper.limitation),
  ]);
}

function formatNote(note: ResearchNote): string {
  return block([
    field("paper ID", note.paper_id),
    field("researcher note", note.text),
    field("note stance", note.type),
  ]);
}

function formatExperiment(experiment: Experiment): string {
  return block([
    field("paper ID", experiment.paper_id),
    field("experiment details", experimentDetails([
      detail("scheme", experiment.scheme),
      detail("verify_time_ms", experiment.verify_time_ms),
      detail("signature_size_bytes", experiment.signature_size_bytes),
      detail("communication_kb", experiment.communication_kb),
    ])),
    field("experiment result", experiment.result),
  ]);
}

function experimentDetails(parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((part): part is string => part !== undefined);
  return present.length > 0 ? present.join("; ") : undefined;
}

function detail(name: string, value: string | number | null | undefined): string | undefined {
  const rendered = text(value);
  return rendered === undefined ? undefined : `${name}=${rendered}`;
}

function field(label: string, value: string | number | boolean | null | undefined): string | undefined {
  if (typeof value === "boolean") return `${label}: ${value}`;
  const rendered = text(value);
  return rendered === undefined ? undefined : `${label}: ${rendered}`;
}

function text(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const rendered = String(value).trim();
  return rendered === "" ? undefined : rendered;
}

function block(entries: Array<string | undefined>): string {
  return entries.filter((entry): entry is string => entry !== undefined).join("\n");
}
