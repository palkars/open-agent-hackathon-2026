import { searchPapers } from "./src/data/repository.ts";

const [command, query] = process.argv.slice(2);

if (command !== "search" || !query?.trim()) {
  console.error('Usage: npx tsx research-os/research.ts search "<query>"');
  process.exitCode = 1;
} else {
  for (const paper of searchPapers(query)) {
    console.log(`${paper.paper_id}\n${paper.title}\n`);
  }
}
