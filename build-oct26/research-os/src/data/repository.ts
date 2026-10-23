import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Paper {
  paper_id: string;
  title: string;
  year: number;
  topic: string;
  method: string;
  provides_anonymity: boolean;
  provides_traceability: boolean;
  post_quantum: boolean;
  trusted_opener_required: boolean;
  key_claim: string;
  limitation: string;
}

export interface Note {
  note_id: string;
  date: string;
  type: string;
  text: string;
  confidence: number;
  related_papers: string[];
}

export interface Experiment {
  experiment_id: string;
  paper_id: string;
  scheme: string;
  security_level: number;
  signature_size_bytes: number;
  sign_time_ms: number;
  verify_time_ms: number;
  result: string;
}

const dataDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
);

function loadJson<T>(filename: string): T {
  const filePath = path.join(dataDirectory, filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

export function loadPapers(): Paper[] {
  return loadJson<Paper[]>("papers.json");
}

export function loadNotes(): Note[] {
  return loadJson<Note[]>("notes.json");
}

export function loadExperiments(): Experiment[] {
  return loadJson<Experiment[]>("experiments.json");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchPapers(query: string): Paper[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const papers = loadPapers();

  if (terms.length === 0) {
    return papers;
  }

  return papers.filter((paper) => {
    const searchableText = normalize(
      Object.entries(paper)
        .flatMap(([field, value]) => [field, String(value)])
        .join(" "),
    );
    return terms.every((term) => searchableText.includes(term));
  });
}
