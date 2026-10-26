import { HMEM } from "./vendor/hmem/src/index.ts";
import { Markovian, resetRunSeq, type MarkovianRun } from "./vendor/markovian/src/index.ts";

const CLOCK = () => 1_750_000_000_000;
const GOAL = "Can post-quantum anonymity and traceability be achieved without requiring a single trusted opener?";
const SETTLED_STEP = "settle whether a trusted opener is required";
const STEPS = [
  SETTLED_STEP,
  "compare the post-quantum schemes",
  "state the research conclusion",
];
const CHUNK_CONFIG = { chunkSize: 2000, maxChunks: 3, carryoverTokens: 128 };

function generator(): (prompt: string) => Promise<{ text: string }> {
  let cursor = 0;
  return async (prompt: string) => {
    const lines: string[] = [];
    if (prompt.includes("[MEMORY CONTEXT]") && cursor < STEPS.length && STEPS[cursor] === SETTLED_STEP) {
      lines.push(`already resolved from memory: ${STEPS[cursor]}`);
      cursor += 1;
    }
    const step = STEPS[cursor];
    if (!step) return { text: "[TASK_COMPLETE]" };
    cursor += 1;
    const done = cursor >= STEPS.length;
    const marker = done
      ? "[TASK_COMPLETE]"
      : [
          "[STATE_CHECKPOINT]",
          `COMPLETED: ${STEPS.slice(0, cursor).join("; ")}`,
          `REMAINING: ${STEPS.slice(cursor).join("; ")}`,
          "DECISIONS: a settled step is not repeated",
          "CONTEXT: post-quantum anonymity and traceability",
        ].join("\n");
    return { text: [...lines, `worked: ${step}`].join("\n") + "\n" + marker };
  };
}

function reinjection(): string {
  const hmem = new HMEM({ clock: CLOCK });
  hmem.add({
    content: `Already settled: ${SETTLED_STEP}. Post-quantum anonymity and traceability do not require a single trusted opener.`,
    type: "factual",
    tags: ["CLAIM"],
    confidence: 0.9,
    source: "P015",
    provenance: { origin: "document", learnedAt: CLOCK(), label: "CLAIM", refs: ["P015"] },
  });
  return hmem.query(GOAL, { threshold: 0, topN: 5 }).context;
}

async function run(memoryContext?: string): Promise<MarkovianRun> {
  resetRunSeq();
  const markovian = new Markovian({ chunkConfig: CHUNK_CONFIG, clock: CLOCK });
  return markovian.run({
    goal: GOAL,
    mode: "RESEARCH",
    memoryContext,
    generator: generator(),
    reflect: false,
  });
}

function problems(cold: MarkovianRun, warm: MarkovianRun, memoryContext: string): string[] {
  const found: string[] = [];
  if (!memoryContext.includes("[MEMORY CONTEXT]") || !memoryContext.includes(SETTLED_STEP)) {
    found.push("warm memory context is not an H-MEM reinjection of the settled step");
  }
  for (const [label, run] of [["cold", cold], ["warm", warm]] as const) {
    if (run.status !== "completed") found.push(`${label} status is ${run.status}`);
    if (run.chunks.length > CHUNK_CONFIG.maxChunks) found.push(`${label} exceeded ${CHUNK_CONFIG.maxChunks} chunks`);
    if (run.chunkConfig.chunkSize < 1000) found.push(`${label} chunkSize is below 1000`);
    if (run.chunkConfig.maxChunks !== 3) found.push(`${label} maxChunks is not 3`);
    if (run.chunkConfig.carryoverTokens < 128) found.push(`${label} carryoverTokens is below 128`);
    if (run.reflection !== undefined) found.push(`${label} ran reflection`);
    if (/STATE_CHECKPOINT|TASK_COMPLETE/.test(run.output)) found.push(`${label} left markers in the output`);
    const carried = run.chunks.slice(1).map((chunk) => chunk.carryover).join("\n");
    for (const field of ["COMPLETED:", "REMAINING:", "DECISIONS:", "CONTEXT:"]) {
      if (!carried.includes(field)) found.push(`${label} carryover is missing ${field}`);
    }
  }
  if (!(warm.chunks.length < cold.chunks.length)) {
    found.push(`warm used ${warm.chunks.length} chunks and cold used ${cold.chunks.length}`);
  }
  if (!warm.output.includes(`already resolved from memory: ${SETTLED_STEP}`)) {
    found.push("warm run did not mark the settled step resolved");
  }
  if (cold.output.includes("already resolved from memory")) found.push("cold run treated a step as already resolved");
  return found;
}

function printRun(label: string, run: MarkovianRun): void {
  console.log(label);
  console.log(`chunks: ${run.chunks.length}`);
  console.log(`status: ${run.status}`);
  console.log(run.output);
  console.log("");
}

const memoryContext = reinjection();
const cold = await run();
const warm = await run(memoryContext);
const failed = problems(cold, warm, memoryContext);

console.log("GOAL");
console.log(GOAL);
console.log("");
printRun("COLD", cold);
printRun("WARM", warm);
console.log("CHECKS");
if (failed.length === 0) {
  console.log("pass");
  console.log(`warm finished in ${warm.chunks.length} chunks; cold finished in ${cold.chunks.length}`);
} else {
  for (const problem of failed) console.log(problem);
  process.exitCode = 1;
}
