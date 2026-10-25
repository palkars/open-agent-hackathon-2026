// Markovian engine loader, mirroring src/engine.ts for H-MEM: the vendored
// reference (npm run setup:markovian) first, then the monorepo sibling.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Markovian, estimateTokens } from "../../../vendor/markovian/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildRoot = path.join(here, "..", "..", "..");
const CANDIDATES = [
  { label: "vendor/markovian", entry: path.join(buildRoot, "vendor", "markovian", "src", "index.ts") },
  { label: "monorepo sibling", entry: path.join(buildRoot, "..", "..", "engines", "markovian", "reference", "src", "index.ts") },
];

export interface LoadedMarkovian {
  Markovian: typeof Markovian;
  estimateTokens: typeof estimateTokens;
  source: string;
}

export async function loadMarkovian(): Promise<LoadedMarkovian> {
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate.entry)) {
      const mod = await import(pathToFileURL(candidate.entry).href);
      return { Markovian: mod.Markovian, estimateTokens: mod.estimateTokens, source: candidate.label };
    }
  }
  throw new Error("Markovian engine not found. Run the setup step first: npm run setup:markovian");
}
