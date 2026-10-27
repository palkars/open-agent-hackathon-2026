import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchAgent } from "./src/agents/research-agent.ts";
import { DeterministicResearchReasoner } from "./src/reasoning/deterministic-reasoner.ts";
import type { ResearchConclusion, ResearchContext } from "./src/agents/types.ts";
import type { ResearchEvidence } from "./src/data/types.ts";
import { ResearchMemory } from "./src/memory/research-memory.ts";
import {
  ZetarisResearchRepository,
  type PotentiallyConflictingEvidence,
  type TraceableScheme,
} from "./src/zetaris/repository.ts";
import { ZetarisClientError, type ZetarisErrorKind } from "./src/zetaris/types.ts";

const QUESTION = "Can post-quantum anonymity and traceability be achieved without requiring a single trusted opener?";

const ERROR_CATEGORY: Record<ZetarisErrorKind, string> = {
  config: "CONFIGURATION_ERROR",
  connection: "CONNECTION_ERROR",
  auth: "AUTHENTICATION_ERROR",
  query: "QUERY_ERROR",
};

function loadResearchOsEnv(): void {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function known(value: string | number | boolean | null | undefined, unit?: string): string {
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number" && Number.isFinite(value)) return unit ? `${value} ${unit}` : String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "unknown";
}

function sourceIds(record: ResearchContext["priorMemories"]["memories"][number]["memory"]): string {
  const refs = record.provenance?.refs?.filter((ref) => ref.trim()) ?? [];
  if (refs.length > 0) return refs.join(", ");
  return known(record.source);
}

function printMemories(context: ResearchContext): void {
  const memories = context.priorMemories.memories;
  console.log(`Prior memories: ${memories.length}`);
  console.log("");
  for (const hit of memories) {
    const record = hit.memory;
    console.log(`Type: ${known(record.provenance?.label ?? record.type)}`);
    console.log(`Content: ${known(record.content)}`);
    console.log(`Confidence: ${known(record.confidence)}`);
    console.log(`Source IDs: ${sourceIds(record)}`);
    console.log("");
  }
}

interface EvidenceRecord {
  paperId: string;
  title: string;
  cryptoMethod?: string;
  anonymity?: boolean | null;
  traceability?: boolean | null;
  trustedOpenerRequired?: boolean | null;
  noteStance?: string;
  note?: string;
  verifyTimeMs?: number;
  signatureSizeBytes?: number;
  experimentResult?: string;
}

function isResearchEvidence(evidence: ResearchContext["currentEvidence"]): evidence is ResearchEvidence {
  return !Array.isArray(evidence);
}

function isConflict(row: TraceableScheme | PotentiallyConflictingEvidence): row is PotentiallyConflictingEvidence {
  return "researcher_note" in row;
}

function evidenceRecords(evidence: ResearchContext["currentEvidence"]): EvidenceRecord[] {
  if (isResearchEvidence(evidence)) {
    return evidence.papers.flatMap((paper) => {
      const notes = evidence.notes.filter((note) => note.paper_id === paper.paper_id);
      const experiments = evidence.experiments.filter((experiment) => experiment.paper_id === paper.paper_id);
      const rows = Math.max(notes.length, experiments.length, 1);
      return Array.from({ length: rows }, (_, index) => ({
        paperId: paper.paper_id,
        title: paper.title,
        cryptoMethod: paper.crypto_method,
        anonymity: paper.provides_anonymity,
        traceability: paper.provides_traceability,
        trustedOpenerRequired: paper.trusted_opener_required,
        noteStance: notes[index]?.type,
        note: notes[index]?.text,
        verifyTimeMs: experiments[index]?.verify_time_ms,
        signatureSizeBytes: experiments[index]?.signature_size_bytes,
        experimentResult: experiments[index]?.result,
      }));
    });
  }

  return evidence.map((row) => {
    if (isConflict(row)) {
      return {
        paperId: row.paper_id,
        title: row.title,
        trustedOpenerRequired: row.trusted_opener_required,
        noteStance: row.note_stance,
        note: row.researcher_note,
        experimentResult: row.experiment_result,
      };
    }
    return {
      paperId: row.paper_id,
      title: row.title,
      cryptoMethod: row.crypto_method,
      anonymity: row.provides_anonymity,
      traceability: row.provides_traceability,
      trustedOpenerRequired: row.trusted_opener_required,
      verifyTimeMs: row.verify_time_ms,
      signatureSizeBytes: row.signature_size_bytes,
      experimentResult: row.result,
    };
  });
}

function printEvidence(context: ResearchContext): void {
  const records = evidenceRecords(context.currentEvidence);
  console.log(`Current evidence: ${records.length}`);
  console.log("");
  for (const record of records) {
    console.log(`Paper ID: ${known(record.paperId)}`);
    console.log(`Title: ${known(record.title)}`);
    console.log(`Crypto method: ${known(record.cryptoMethod)}`);
    console.log(`Anonymity: ${known(record.anonymity)}`);
    console.log(`Traceability: ${known(record.traceability)}`);
    console.log(`Trusted opener required: ${known(record.trustedOpenerRequired)}`);
    console.log(`Researcher note stance: ${known(record.noteStance)}`);
    console.log(`Researcher note: ${known(record.note)}`);
    console.log(`Verify time: ${known(record.verifyTimeMs, "ms")}`);
    console.log(`Signature size: ${known(record.signatureSizeBytes, "bytes")}`);
    console.log(`Experiment result: ${known(record.experimentResult)}`);
    console.log("");
  }
}

function printList(values: string[]): void {
  if (values.length === 0) {
    console.log("none");
    return;
  }
  for (const value of values) console.log(value);
}

function printAssessment(conclusion: ResearchConclusion): void {
  console.log("ASSESSMENT");
  console.log("------------------------------------------------");
  console.log("");
  console.log("Status:");
  console.log(conclusion.assessment);
  console.log("");
  console.log("Summary:");
  console.log(conclusion.summary);
  console.log("");
  console.log("Confidence:");
  console.log(conclusion.confidence);
  console.log("");
  console.log("Supporting sources:");
  printList(conclusion.supportingSourceIds);
  console.log("");
  console.log("Conflicting sources:");
  printList(conclusion.conflictingSourceIds);
  console.log("");
  console.log("Open questions:");
  printList(conclusion.openQuestions);
  console.log("");
}

function printReport(context: ResearchContext, conclusion: ResearchConclusion): void {
  console.log("================================================");
  console.log("RESEARCHOS — PHASE 14");
  console.log("================================================");
  console.log("");
  console.log("QUESTION");
  console.log(context.question.question);
  console.log("");
  console.log("METERLESS H-MEM");
  console.log("----------------");
  printMemories(context);
  console.log("ZETARIS");
  console.log("----------------");
  printEvidence(context);
  printAssessment(conclusion);
}

try {
  
  loadResearchOsEnv();
  const memory = await ResearchMemory.create();
  const repository = ZetarisResearchRepository.fromEnv();
  const agent = new ResearchAgent(memory, repository, new DeterministicResearchReasoner());
  const context = await agent.gatherResearchContext(QUESTION);
  const conclusion = await agent.assessResearchContext(context);
  printReport(context, conclusion);
} catch (error) {
  if (error instanceof ZetarisClientError) {
    console.error(ERROR_CATEGORY[error.kind]);
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("CONNECTION_ERROR");
  }
  process.exitCode = 1;
}
