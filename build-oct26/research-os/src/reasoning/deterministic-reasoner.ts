import type { EvidenceAssessment, ResearchConclusion, ResearchContext } from "../agents/types.ts";
import type { Experiment, Paper, ResearchEvidence, ResearchNote } from "../data/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme } from "../zetaris/repository.ts";
import type { ResearchReasoner } from "./types.ts";

const SUPPORTED_WITH_PASSING_EXPERIMENT = 0.75;
const SUPPORTED_FROM_PAPER_FLAGS = 0.6;
const MIXED_WITHOUT_NOTE_CONFIDENCE = 0.5;
const CONTRADICTED_CONFIDENCE = 0.7;

interface EvidenceSignal {
  paperId?: string;
  supports: boolean;
  skeptical: boolean;
  contradicts: boolean;
  experimentPassed: boolean;
  noteConfidence?: number;
  openQuestion?: string;
}

export class DeterministicResearchReasoner implements ResearchReasoner {
  async assess(context: ResearchContext): Promise<ResearchConclusion> {
    const openQuestions = collectOpenQuestions(context);
    if (!asksAboutPostQuantumTraceabilityWithoutOpener(context.question.question)) {
      return conclusion(
        "INSUFFICIENT",
        "The baseline evidence rules do not cover this question.",
        0,
        [],
        [],
        openQuestions,
      );
    }

    const signals = evidenceSignals(context.currentEvidence);
    const supporting = signals.filter((signal) => signal.supports && signal.paperId);
    const skeptical = signals.filter((signal) => signal.skeptical && signal.paperId);
    const contradicting = signals.filter((signal) => signal.contradicts && signal.paperId);
    const supportingSourceIds = uniqueIds(supporting.map((signal) => signal.paperId));
    const conflictingSourceIds = uniqueIds([...skeptical, ...contradicting].map((signal) => signal.paperId));

    if (supportingSourceIds.length === 0 && conflictingSourceIds.length === 0) {
      return conclusion(
        "INSUFFICIENT",
        "No relevant Zetaris evidence was returned for this question.",
        0,
        [],
        [],
        openQuestions,
      );
    }

    if (supportingSourceIds.length > 0 && skeptical.length === 0 && contradicting.length === 0) {
      const experimentPassed = supporting.every((signal) => signal.experimentPassed);
      return conclusion(
        "SUPPORTED",
        "Qualifying Zetaris papers or experiments support post-quantum anonymity and traceability without a single trusted opener. No skeptical researcher notes are present.",
        experimentPassed ? SUPPORTED_WITH_PASSING_EXPERIMENT : SUPPORTED_FROM_PAPER_FLAGS,
        supportingSourceIds,
        [],
        openQuestions,
      );
    }

    if (supportingSourceIds.length > 0) {
      return conclusion(
        "MIXED",
        mixedSummary(skeptical.length > 0, contradicting.length > 0),
        mixedConfidence(skeptical),
        supportingSourceIds,
        conflictingSourceIds,
        openQuestions,
      );
    }

    if (contradicting.length > 0) {
      return conclusion(
        "CONTRADICTED",
        "Zetaris evidence contradicts post-quantum anonymity and traceability without a single trusted opener.",
        CONTRADICTED_CONFIDENCE,
        [],
        conflictingSourceIds,
        openQuestions,
      );
    }

    return conclusion(
      "INSUFFICIENT",
      "Relevant Zetaris records are present, but they do not qualify as support or a clear contradiction.",
      0,
      [],
      conflictingSourceIds,
      openQuestions,
    );
  }
}

function conclusion(
  assessment: EvidenceAssessment,
  summary: string,
  confidence: number,
  supportingSourceIds: string[],
  conflictingSourceIds: string[],
  openQuestions: string[],
): ResearchConclusion {
  return {
    assessment,
    summary,
    confidence,
    supportingSourceIds,
    conflictingSourceIds,
    openQuestions,
  };
}

function asksAboutPostQuantumTraceabilityWithoutOpener(question: string): boolean {
  const text = question.toLowerCase();
  const postQuantum = text.includes("post-quantum") || text.includes("post quantum");
  const anonymity = text.includes("anonymity") || text.includes("anonymous");
  const traceability = text.includes("traceability") || text.includes("traceable");
  const opener = text.includes("opener") || text.includes("opening authority");
  const withoutOpener = text.includes("without") || text.includes("no single") || text.includes("not requiring");
  return postQuantum && anonymity && traceability && opener && withoutOpener;
}

function evidenceSignals(evidence: ResearchContext["currentEvidence"]): EvidenceSignal[] {
  if (isResearchEvidence(evidence)) return researchEvidenceSignals(evidence);
  return evidence.map((row) => (isConflict(row) ? conflictSignal(row) : schemeSignal(row)));
}

function schemeSignal(scheme: TraceableScheme): EvidenceSignal {
  const failed = isFail(scheme.result);
  const passed = isPass(scheme.result);
  const noTrustedOpener = scheme.trusted_opener_required === false;
  const requiresOpener = scheme.trusted_opener_required === true;
  return {
    paperId: scheme.paper_id,
    supports: scheme.post_quantum && scheme.provides_anonymity && scheme.provides_traceability && noTrustedOpener && !failed,
    skeptical: false,
    contradicts: failed || requiresOpener,
    experimentPassed: passed,
  };
}

function conflictSignal(row: PotentiallyConflictingEvidence): EvidenceSignal {
  const failed = isFail(row.experiment_result);
  const skeptical = isSkeptical(row.note_stance) && mentionsProposition(row.researcher_note);
  return {
    paperId: row.paper_id,
    supports: false,
    skeptical,
    contradicts: failed || row.trusted_opener_required === true,
    experimentPassed: isPass(row.experiment_result),
    noteConfidence: skeptical ? row.note_confidence : undefined,
  };
}

function researchEvidenceSignals(evidence: ResearchEvidence): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  const paperIds = new Set(evidence.papers.map((paper) => paper.paper_id));

  for (const paper of evidence.papers) {
    const notes = evidence.notes.filter((note) => note.paper_id === paper.paper_id);
    const experiments = evidence.experiments.filter((experiment) => experiment.paper_id === paper.paper_id);
    signals.push(paperSignal(paper, notes, experiments));
    for (const note of notes) {
      const openQuestion = openQuestionText(note);
      if (openQuestion) signals.push(openQuestionSignal(paper.paper_id, openQuestion));
    }
  }

  for (const note of evidence.notes) {
    if (note.paper_id && paperIds.has(note.paper_id)) continue;
    const skeptical = isSkeptical(note.type) && mentionsProposition(note.text);
    const openQuestion = openQuestionText(note);
    if (!skeptical && !openQuestion) continue;
    signals.push({
      paperId: note.paper_id,
      supports: false,
      skeptical,
      contradicts: false,
      experimentPassed: false,
      noteConfidence: skeptical ? note.confidence : undefined,
      openQuestion,
    });
  }

  return signals;
}

function paperSignal(paper: Paper, notes: ResearchNote[], experiments: Experiment[]): EvidenceSignal {
  const failed = experiments.some((experiment) => isFail(experiment.result));
  const passed = experiments.some((experiment) => isPass(experiment.result));
  const qualifyingFlags = paper.post_quantum === true
    && paper.provides_anonymity === true
    && paper.provides_traceability === true;
  const skepticalNotes = notes.filter((note) => isSkeptical(note.type) && mentionsProposition(note.text));
  return {
    paperId: paper.paper_id,
    supports: qualifyingFlags && paper.trusted_opener_required === false && !failed,
    skeptical: skepticalNotes.length > 0,
    contradicts: failed || (qualifyingFlags && paper.trusted_opener_required === true),
    experimentPassed: passed,
    noteConfidence: mean(skepticalNotes.map((note) => note.confidence)),
  };
}

function openQuestionSignal(paperId: string | undefined, openQuestion: string): EvidenceSignal {
  return {
    paperId,
    supports: false,
    skeptical: false,
    contradicts: false,
    experimentPassed: false,
    openQuestion,
  };
}

function collectOpenQuestions(context: ResearchContext): string[] {
  const questions: string[] = [];
  for (const hit of context.priorMemories.memories) {
    const record = hit.memory;
    const label = record.provenance?.label;
    const tagged = record.tags.some((tag) => isOpenQuestion(tag));
    if ((isOpenQuestion(label) || tagged) && record.content.trim()) questions.push(record.content.trim());
  }
  for (const signal of evidenceSignals(context.currentEvidence)) {
    if (signal.openQuestion) questions.push(signal.openQuestion);
  }
  return uniqueText(questions);
}

function openQuestionText(note: ResearchNote): string | undefined {
  const text = note.text.trim();
  return isOpenQuestion(note.type) && text ? text : undefined;
}

function mixedSummary(skeptical: boolean, contradicting: boolean): string {
  if (skeptical && contradicting) {
    return "Qualifying Zetaris evidence supports the proposition, and skeptical researcher notes plus contradicting evidence are also present.";
  }
  if (skeptical) {
    return "Qualifying Zetaris evidence supports the proposition, and one or more skeptical researcher notes are present.";
  }
  return "Qualifying Zetaris evidence supports the proposition, and some evidence contradicts it.";
}

function mixedConfidence(skeptical: EvidenceSignal[]): number {
  const confidence = mean(skeptical.map((signal) => signal.noteConfidence));
  return confidence ?? MIXED_WITHOUT_NOTE_CONFIDENCE;
}

function isResearchEvidence(evidence: ResearchContext["currentEvidence"]): evidence is ResearchEvidence {
  return !Array.isArray(evidence);
}

function isConflict(row: TraceableScheme | PotentiallyConflictingEvidence): row is PotentiallyConflictingEvidence {
  return "researcher_note" in row;
}

function isSkeptical(value: string | undefined): boolean {
  return value?.trim().toUpperCase() === "SKEPTICAL";
}

function isOpenQuestion(value: string | undefined): boolean {
  return value?.trim().toUpperCase() === "OPEN_QUESTION";
}

function mentionsProposition(text: string | undefined): boolean {
  const value = text?.trim().toLowerCase() ?? "";
  if (!value) return false;
  return value.includes("opener")
    || value.includes("opening authority")
    || value.includes("traceab")
    || value.includes("anonym");
}

function isPass(result: string | undefined): boolean {
  return /^(pass|passed|success)$/i.test(result?.trim() ?? "");
}

function isFail(result: string | undefined): boolean {
  return /^(fail|failed|failure)$/i.test(result?.trim() ?? "");
}

function uniqueIds(ids: Array<string | undefined>): string[] {
  return uniqueText(ids.filter((id): id is string => Boolean(id?.trim())));
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  return unique;
}

function mean(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return undefined;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}
