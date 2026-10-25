import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Zetaris and Meterless settings live in build-oct26/.env (gitignored), as the
// participant guide prescribes. Variables already set in the shell win.
export const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}
