import type { Paper } from "../data/repository.ts";
import type { ResearchFinding } from "../memory/research-memory.ts";
import type { EvidenceLedger } from "./tools.ts";

// Phase 16: how evidence relates to what the researcher already believes.
// The rules below are the offline evaluator. They only reason about the
// attributes the evidence records (trusted opener, traceability, anonymity),
// so they are explicit about what they cannot judge. A model route replaces
// them with Nemotron's evaluation, grounded against the same ledger.

export const RELATIONSHIPS = ["SUPPORTS", "CONTRADICTS", "EXTENDS", "UNRELATED"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export interface Evaluation {
  relationship: Relationship;
  // The memory being judged; null when the subject is the question itself.
  memoryId: string | null;
  evidence: string[];
  confidence: number;
  reason: string;
  by: "rules" | "model";
}

export interface LearnedConclusion {
  content: string;
  evidence: string[];
  confidence: number;
}

export type Proposition = "TRUSTED_OPENER_REQUIRED" | "TRACEABLE_WITHOUT_TRUSTED_OPENER" | "ANONYMITY_WITH_TRACEABILITY";

export const DECISIVE_CONFIDENCE = 0.75;
const BASE_CONFIDENCE = 0.7;
const CORROBORATED_CONFIDENCE = 0.85;
const OPENER = String.raw`trusted\s+open(?:er|ing)`;
const WITHOUT_OPENER = new RegExp(String.raw`\b(?:without|no|not|rather than|instead of)\b[^.?]{0,40}${OPENER}|\b(?:distributed|threshold)\s+(?:threshold\s+)?open(?:ing|er)`, "i");
const REQUIRES_OPENER = new RegExp(
  String.raw`\b(?:requires?|required|needs?|must|depends? on|necessary)\b[^.?]{0,40}${OPENER}|${OPENER}[^.?]{0,30}\b(?:required|necessary|needed)\b`,
  "i",
);

export function propositionOf(text: string): Proposition | undefined {
  if (WITHOUT_OPENER.test(text)) return "TRACEABLE_WITHOUT_TRUSTED_OPENER";
  if (REQUIRES_OPENER.test(text)) return "TRUSTED_OPENER_REQUIRED";
  if (/anonym/i.test(text) && /traceab/i.test(text)) return "ANONYMITY_WITH_TRACEABILITY";
  return undefined;
}

function isQuestion(text: string, finding?: ResearchFinding): boolean {
  return finding?.type === "OPEN_QUESTION" || text.trim().endsWith("?");
}

// A passing experiment on the paper corroborates it.
function corroboration(paper: Paper, ledger: EvidenceLedger): { evidence: string[]; confidence: number } {
  const passing = [...ledger.experiments.values()].filter((e) => e.paper_id === paper.paper_id && e.result.toUpperCase() === "PASS");
  return passing.length > 0
    ? { evidence: [paper.paper_id, ...passing.map((e) => e.experiment_id)], confidence: CORROBORATED_CONFIDENCE }
    : { evidence: [paper.paper_id], confidence: BASE_CONFIDENCE };
}

function judge(proposition: Proposition, asked: boolean, onMemory: boolean, paper: Paper): { relationship: Relationship; reason: string } | undefined {
  const traceableWithoutOpener = paper.provides_traceability && !paper.trusted_opener_required;
  switch (proposition) {
    case "TRUSTED_OPENER_REQUIRED":
      if (traceableWithoutOpener) {
        return { relationship: "CONTRADICTS", reason: `${paper.paper_id} (${paper.method}) provides traceability without a trusted opener: ${paper.key_claim}` };
      }
      if (paper.provides_traceability) {
        return { relationship: "SUPPORTS", reason: `${paper.paper_id} provides traceability and needs a trusted opener (${paper.limitation})` };
      }
      return undefined;
    case "TRACEABLE_WITHOUT_TRUSTED_OPENER":
      if (!traceableWithoutOpener) return undefined;
      // Evidence that answers a remembered open question extends what we know.
      return {
        relationship: asked && onMemory ? "EXTENDS" : "SUPPORTS",
        reason: `${paper.paper_id} (${paper.method}) provides traceability without a trusted opener: ${paper.key_claim}`,
      };
    case "ANONYMITY_WITH_TRACEABILITY":
      if (!(paper.provides_anonymity && paper.provides_traceability)) return undefined;
      return { relationship: "SUPPORTS", reason: `${paper.paper_id} provides both anonymity and traceability` };
  }
}

function evaluateSubject(text: string, finding: ResearchFinding | undefined, ledger: EvidenceLedger): Evaluation[] {
  const memoryId = finding?.id ?? null;
  const proposition = propositionOf(text);
  if (!proposition) {
    return finding
      ? [{ relationship: "UNRELATED", memoryId, evidence: [], confidence: BASE_CONFIDENCE, reason: "no gathered evidence speaks to this memory", by: "rules" }]
      : [];
  }
  const evaluations: Evaluation[] = [];
  for (const paper of ledger.papers.values()) {
    const verdict = judge(proposition, isQuestion(text, finding), finding !== undefined, paper);
    if (!verdict) continue;
    const { evidence, confidence } = corroboration(paper, ledger);
    evaluations.push({ relationship: verdict.relationship, memoryId, evidence, confidence, reason: verdict.reason, by: "rules" });
  }
  if (finding && evaluations.length === 0) {
    evaluations.push({ relationship: "UNRELATED", memoryId, evidence: [], confidence: BASE_CONFIDENCE, reason: "none of the gathered papers bears on this memory", by: "rules" });
  }
  return evaluations;
}

export function evaluateEvidence(question: string, ledger: EvidenceLedger): Evaluation[] {
  const evaluations = evaluateSubject(question, undefined, ledger);
  for (const finding of ledger.memories.values()) evaluations.push(...evaluateSubject(finding.content, finding, ledger));
  return evaluations;
}

export function isDecisive(evaluation: Evaluation): boolean {
  return evaluation.relationship !== "UNRELATED" && evaluation.confidence >= DECISIVE_CONFIDENCE;
}

// Enough evidence: the question itself has a decisive answer, or, when the
// rules can't read the question, some memory has been decisively judged.
export function hasEnoughEvidence(question: string, evaluations: Evaluation[]): boolean {
  if (propositionOf(question)) return evaluations.some((e) => e.memoryId === null && isDecisive(e));
  return evaluations.some(isDecisive);
}

export interface ComposedAnswer {
  answer: string;
  learned?: LearnedConclusion;
}

// Offline answer: assembled from the evaluations, citing every ID it uses.
export function composeAnswer(question: string, evaluations: Evaluation[], ledger: EvidenceLedger): ComposedAnswer {
  const proposition = propositionOf(question);
  const onQuestion = evaluations.filter((e) => e.memoryId === null && e.relationship !== "UNRELATED");
  const strongest = (relationship: Relationship) =>
    onQuestion.filter((e) => e.relationship === relationship).sort((a, b) => b.confidence - a.confidence)[0];
  const describe = (e: Evaluation) => {
    const paper = ledger.papers.get(e.evidence[0]);
    const experiments = e.evidence.slice(1).map((id) => {
      const experiment = ledger.experiments.get(id);
      return experiment ? `${id} (${experiment.scheme}, ${experiment.result})` : id;
    });
    const corroborated = experiments.length > 0 ? ` Corroborated by experiment ${experiments.join(", ")}.` : " No experiment corroborates it yet.";
    return `${e.evidence[0]} "${paper?.title ?? e.evidence[0]}" (${paper?.method ?? "?"}): ${paper?.key_claim ?? e.reason}${corroborated}`;
  };
  const learnFrom = (e: Evaluation | undefined): LearnedConclusion | undefined => {
    const paper = e && ledger.papers.get(e.evidence[0]);
    return e && paper && e.confidence >= DECISIVE_CONFIDENCE ? { content: paper.key_claim, evidence: e.evidence, confidence: e.confidence } : undefined;
  };

  let answer: string;
  let learned: LearnedConclusion | undefined;
  if (proposition === "TRACEABLE_WITHOUT_TRUSTED_OPENER") {
    const yes = strongest("SUPPORTS");
    answer = yes
      ? `Yes. The evidence suggests traceability does not need a single trusted opener. ${describe(yes)}`
      : "Not shown by the evidence gathered: no traceable scheme found works without a trusted opener.";
    learned = learnFrom(yes);
  } else if (proposition === "TRUSTED_OPENER_REQUIRED") {
    const no = strongest("CONTRADICTS");
    const yes = onQuestion.filter((e) => e.relationship === "SUPPORTS").map((e) => e.evidence[0]);
    answer = no
      ? `No, not necessarily. ${describe(no)}`
      : yes.length > 0
        ? `In the evidence gathered, yes: ${yes.join(", ")} provide traceability only with a trusted opener.`
        : "The evidence gathered doesn't settle it.";
    learned = learnFrom(no);
  } else if (proposition === "ANONYMITY_WITH_TRACEABILITY") {
    const both = onQuestion.filter((e) => e.relationship === "SUPPORTS");
    const ids = both.map((e) => e.evidence[0]);
    answer = ids.length > 0 ? `Yes: ${ids.join(", ")} provide both anonymity and traceability.` : "No scheme gathered provides both.";
    const best = both.sort((a, b) => b.confidence - a.confidence)[0];
    learned = best && best.confidence >= DECISIVE_CONFIDENCE
      ? { content: `Schemes ${ids.join(", ")} provide both anonymity and traceability.`, evidence: [...new Set(both.flatMap((e) => e.evidence))], confidence: best.confidence }
      : undefined;
  } else {
    answer = "The offline rules only judge claims about trusted openers, anonymity and traceability. Connect a model route (Meterless Nightshift) to answer open-ended questions; the memory and evidence relations found are listed below.";
  }

  // Only beliefs still in force; already-revised ones stay in the evaluations.
  const contradictions = evaluations.filter((e) => e.memoryId && e.relationship === "CONTRADICTS" && !ledger.memories.get(e.memoryId)?.supersededBy);
  const contradicted = [...new Set(contradictions.map((e) => e.memoryId!))];
  if (contradicted.length > 0) {
    const lines = contradicted.map((id) => `${id} "${ledger.memories.get(id)?.content ?? id}"`);
    answer += ` This contradicts research memory: ${lines.join("; ")}`;
  }
  return { answer, learned };
}
