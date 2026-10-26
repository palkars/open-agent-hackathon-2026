import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchAgentResult } from "../src/agents/types.ts";
import type { ResearchEvidence } from "../src/data/types.ts";
import { ZetarisClientError } from "../src/zetaris/types.ts";
import type { PotentiallyConflictingEvidence, TraceableScheme } from "../src/zetaris/repository.ts";

const PORT = Number(process.env.RESEARCH_UI_PORT) || 4173;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "index.html");
const SAFE_RESEARCH_FAILURES = new Set([
  "MEMORY_RETRIEVAL_ERROR",
  "ZETARIS_AUTHENTICATION_ERROR",
  "ZETARIS_CONNECTION_ERROR",
  "REASONING_ERROR",
  "EVALUATION_ERROR",
  "Research question cannot be empty",
]);

function loadResearchOsEnv(): void {
  const envPath = path.join(HERE, "..", ".env");
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

function safeResearchFailure(error: unknown): string {
  if (error instanceof Error && SAFE_RESEARCH_FAILURES.has(error.message)) return error.message;
  if (error instanceof ZetarisClientError) {
    if (error.kind === "auth") return "ZETARIS_AUTHENTICATION_ERROR";
    if (error.kind === "config" && /password|api[_ ]?key|username|credential|unauthor|forbidden/i.test(error.message)) {
      return "ZETARIS_AUTHENTICATION_ERROR";
    }
    return "ZETARIS_CONNECTION_ERROR";
  }
  return "MEMORY_RETRIEVAL_ERROR";
}

function flag(value: boolean | null | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

function evidenceView(evidence: ResearchAgentResult["context"]["currentEvidence"]): Array<Record<string, string>> {
  if (Array.isArray(evidence)) return evidence.map((row) => arrayEvidence(row));
  return papersView(evidence);
}

function papersView(evidence: ResearchEvidence): Array<Record<string, string>> {
  return evidence.papers.map((paper) => ({
    paperId: paper.paper_id,
    title: paper.title,
    method: paper.crypto_method ?? "unknown",
    anonymity: flag(paper.provides_anonymity),
    traceability: flag(paper.provides_traceability),
    trustedOpener: flag(paper.trusted_opener_required),
  }));
}

function arrayEvidence(row: TraceableScheme | PotentiallyConflictingEvidence): Record<string, string> {
  if ("researcher_note" in row) {
    return {
      paperId: row.paper_id,
      title: row.title,
      method: "unknown",
      anonymity: "unknown",
      traceability: "unknown",
      trustedOpener: flag(row.trusted_opener_required),
      stance: row.note_stance,
      note: row.researcher_note,
    };
  }
  return {
    paperId: row.paper_id,
    title: row.title,
    method: row.crypto_method,
    anonymity: flag(row.provides_anonymity),
    traceability: flag(row.provides_traceability),
    trustedOpener: flag(row.trusted_opener_required),
  };
}

function publicResult(result: ResearchAgentResult): Record<string, unknown> {
  return {
    question: result.question.question,
    conclusion: result.conclusion,
    memories: result.context.priorMemories.memories.map((hit) => ({
      id: hit.memory.id,
      label: hit.memory.provenance?.label ?? hit.memory.type,
      content: hit.memory.content,
      confidence: hit.memory.confidence,
      source: hit.memory.source,
      refs: hit.memory.provenance?.refs ?? [],
    })),
    evaluations: result.evaluations,
    evidence: evidenceView(result.context.currentEvidence),
    trace: result.trace,
    markovian: result.markovian,
    iterations: result.iterations,
    memoryStored: result.memoryStored,
    storedMemoryId: result.storedMemoryId ?? null,
    timings: result.timings,
  };
}

function send(response: http.ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(payload);
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw new Error("Research question cannot be empty");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

loadResearchOsEnv();

const [{ ResearchMemory }, { ResearchAgent }, { DeterministicResearchReasoner }, { LLMResearchReasoner }, { ZetarisResearchRepository }] = await Promise.all([
  import("../src/memory/research-memory.ts"),
  import("../src/agents/research-agent.ts"),
  import("../src/reasoning/deterministic-reasoner.ts"),
  import("../src/reasoning/llm-reasoner.ts"),
  import("../src/zetaris/repository.ts"),
]);

const reasoner = (process.env.RESEARCH_REASONER ?? "").trim().toLowerCase() === "llm"
  ? new LLMResearchReasoner()
  : new DeterministicResearchReasoner();
const agent = new ResearchAgent(await ResearchMemory.create(), ZetarisResearchRepository.fromEnv(), reasoner);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    send(response, 200, fs.readFileSync(PAGE, "utf8"), "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    send(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/research") {
    try {
      const body = await readJson(request);
      const question = body && typeof body === "object" && "question" in body && typeof body.question === "string" ? body.question : "";
      send(response, 200, publicResult(await agent.research(question)));
    } catch (error) {
      const message = error instanceof SyntaxError ? "Research question cannot be empty" : safeResearchFailure(error);
      send(response, message === "Research question cannot be empty" ? 400 : 502, { error: message });
    }
    return;
  }
  send(response, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ResearchOS UI http://127.0.0.1:${PORT}`);
});
