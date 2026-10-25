import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Experiment, Paper, ResearchEvidence, ResearchNote } from "./src/data/types.ts";
import { ZetarisClient } from "./src/zetaris/client.ts";
import { ZetarisResearchRepository, type TraceableScheme } from "./src/zetaris/repository.ts";
import { ZetarisClientError, type ZetarisErrorKind } from "./src/zetaris/types.ts";

const CATEGORY: Record<ZetarisErrorKind, string> = {
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

function flag(value: boolean | null | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

function measure(value: number | undefined, unit: string): string {
  return value === undefined ? "unknown" : `${value} ${unit}`;
}

function printPaper(paper: Paper): void {
  console.log(`Paper ID: ${paper.paper_id}`);
  console.log(`Title: ${paper.title}`);
  console.log(`Crypto family: ${paper.crypto_family ?? "unknown"}`);
  console.log(`Crypto method: ${paper.crypto_method ?? "unknown"}`);
  console.log(`Anonymity: ${flag(paper.provides_anonymity)}`);
  console.log(`Traceability: ${flag(paper.provides_traceability)}`);
  console.log(`Trusted opener required: ${flag(paper.trusted_opener_required)}`);
  console.log(`Key claim: ${paper.key_claim ?? ""}`);
}

function printNote(note: ResearchNote): void {
  console.log("Research note:");
  console.log(`Stance: ${note.type ?? "unknown"}`);
  console.log(`Confidence: ${note.confidence ?? "unknown"}`);
  console.log(`Note: ${note.text}`);
}

function printExperiment(experiment: Experiment): void {
  console.log("Experiment:");
  console.log(`Scheme: ${experiment.scheme}`);
  console.log(`Verify time: ${measure(experiment.verify_time_ms, "ms")}`);
  console.log(`Signature size: ${measure(experiment.signature_size_bytes, "bytes")}`);
  console.log(`Communication size: ${measure(experiment.communication_kb, "kb")}`);
  console.log(`Result: ${experiment.result ?? "unknown"}`);
}

function printSchemeTable(schemes: TraceableScheme[]): void {
  console.log("Post-quantum anonymous traceable schemes without a trusted opener:");
  console.log("");
  if (schemes.length === 0) {
    console.log("No schemes returned.");
    return;
  }

  const headers = [
    "Paper ID",
    "Scheme",
    "Crypto method",
    "Verify time",
    "Signature size",
    "Communication size",
    "Result",
  ];
  const rows = schemes.map((scheme) => [
    scheme.paper_id,
    scheme.scheme ?? "",
    scheme.crypto_method,
    scheme.verify_time_ms === undefined ? "" : String(scheme.verify_time_ms),
    scheme.signature_size_bytes === undefined ? "" : String(scheme.signature_size_bytes),
    scheme.communication_kb === undefined ? "" : String(scheme.communication_kb),
    scheme.result ?? "",
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const format = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(format(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(format(row));
}

function printPaperEvidence(evidence: ResearchEvidence): void {
  const paper = evidence.papers[0];
  if (!paper) {
    console.log("Paper ID: P020");
    console.log("No paper returned.");
    return;
  }
  printPaper(paper);
  console.log("");
  if (evidence.notes.length === 0) {
    console.log("Research note:");
    console.log("No note returned.");
  } else {
    for (const note of evidence.notes) {
      printNote(note);
      console.log("");
    }
  }
  if (evidence.experiments.length === 0) {
    console.log("Experiment:");
    console.log("No experiment returned.");
    return;
  }
  for (const [index, experiment] of evidence.experiments.entries()) {
    if (index > 0) console.log("");
    printExperiment(experiment);
  }
}

try {
  loadResearchOsEnv();
  const client = ZetarisClient.fromEnv();
  await client.connect();
  await client.query("SELECT 1");
  console.log("Zetaris connection: OK");
  console.log("");

  const repository = new ZetarisResearchRepository(client);
  const evidence = await repository.getPaperEvidence("P020");
  printPaperEvidence(evidence);
  console.log("");

  const schemes = await repository.findPostQuantumAnonymousTraceableSchemes();
  printSchemeTable(schemes);
  if (
    evidence.papers.length === 0 ||
    evidence.notes.length === 0 ||
    evidence.experiments.length === 0 ||
    schemes.length === 0
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof ZetarisClientError) {
    console.error(CATEGORY[error.kind]);
    console.error(error.message);
  } else {
    console.error("CONNECTION_ERROR");
  }
  process.exitCode = 1;
}
