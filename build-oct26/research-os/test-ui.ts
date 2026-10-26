const base = (process.env.RESEARCH_UI_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const question = "Can post-quantum anonymity and traceability be achieved without requiring a single trusted opener?";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; text: string; json: unknown }> {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}

let health: { status: number };
try {
  health = await request("/api/health");
} catch {
  fail(`UI server is not running. Start it with: npx tsx research-os/ui/server.ts\nThen open ${base}`);
}
if (health.status !== 200) fail(`/api/health returned ${health.status}`);

const page = await request("/");
if (page.status !== 200 || !page.text.includes("H-MEM") || !page.text.includes("Zetaris") || !page.text.includes("Markovian") || !page.text.includes("Nemotron")) {
  fail("index page is missing one of the four pane sources");
}

const empty = await request("/api/research", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question: "   " }),
});
const emptyError = empty.json && typeof empty.json === "object" && "error" in empty.json ? String(empty.json.error) : "";
if (empty.status !== 400 || emptyError !== "Research question cannot be empty") {
  fail(`empty question returned ${empty.status} ${emptyError}`);
}

const research = await request("/api/research", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question }),
  signal: AbortSignal.timeout(180_000),
});
if (research.status !== 200 || !research.json || typeof research.json !== "object") fail(`research returned ${research.status}`);
const result = research.json as {
  question?: string;
  memories?: unknown[];
  evidence?: Array<{ paperId?: string }>;
  evaluations?: Array<{ relationship?: string; recommendation?: string }>;
  trace?: Array<{ step?: string }>;
  markovian?: { chunks?: number; status?: string; resolved?: string[] };
  conclusion?: { assessment?: string };
};
const problems: string[] = [];
if (result.question !== question) problems.push("question was not echoed");
if (!result.memories?.length) problems.push("H-MEM pane has no memories");
if (!result.evidence?.length || result.evidence.some((row) => !row.paperId)) problems.push("Zetaris pane has no paper ids");
if (result.conclusion?.assessment !== "SUPPORTED" && result.conclusion?.assessment !== "CONTRADICTED" && result.conclusion?.assessment !== "MIXED" && result.conclusion?.assessment !== "INSUFFICIENT") {
  problems.push("Nemotron pane has no assessment");
}
const last = result.trace?.[result.trace.length - 1];
if (last?.step !== "Conclusion") problems.push("trace does not end in a conclusion");
if (!result.markovian || (result.markovian.chunks ?? 0) < 1 || (result.markovian.chunks ?? 4) > 3 || !result.markovian.status) {
  problems.push("Markovian chunk status is missing or over the cap");
}
for (const report of result.evaluations ?? []) {
  if (report.relationship === "CONTRADICTS" && report.recommendation !== "Revise existing conclusion.") {
    problems.push("CONTRADICTS recommendation is wrong");
  }
}
const contradictions = (result.evaluations ?? []).filter((report) => report.relationship === "CONTRADICTS").length;

console.log(`UI ${base}`);
console.log(`question: ${result.conclusion?.assessment}`);
console.log(`memories: ${result.memories?.length ?? 0}`);
console.log(`evidence: ${(result.evidence ?? []).map((row) => row.paperId).join(", ")}`);
console.log(`contradictions: ${contradictions}`);
console.log(`markovian: ${result.markovian?.chunks} ${result.markovian?.status}`);
console.log(`trace ends: ${last?.step}`);
console.log("CHECKS");
if (problems.length === 0) console.log("pass");
else {
  for (const problem of problems) console.log(problem);
  process.exitCode = 1;
}
