import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createResearchRepository, dataSourceFromEnv } from "../src/data/research-repository.ts";
import { ResearchMemory } from "../src/memory/research-memory.ts";
import { compareColdWarm, runResearchAgent } from "../src/agents/research-agent.ts";
import { loadMarkovian } from "../src/agents/markovian.ts";
import { ModelClient, resolveRoutes } from "../src/llm/provider.ts";

// Local web UI (Phase 20). Served on 127.0.0.1 only; the page talks to the
// same agent, memory and repository code as the CLI.

const INDEX_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");
const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Each H-MEM instance holds its own copy of the store, so anything that reads
// or writes research memory runs one request at a time.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  // JSON-only POSTs can't be sent cross-site without a CORS preflight.
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "send application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}") as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

function questionFrom(body: Record<string, unknown>): string {
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) throw new HttpError(400, "question is required");
  if (question.length > 500) throw new HttpError(400, "question is too long (500 characters max)");
  return question;
}

async function status() {
  const { primary, problems, forcedOffline } = resolveRoutes();
  let model: Record<string, unknown> = { route: "offline", detail: forcedOffline ? "forced offline" : "no model route configured" };
  if (primary) {
    const discovery = await new ModelClient(primary).discover();
    model = { route: primary.id, model: primary.model, baseUrl: primary.baseUrl, status: discovery.status, detail: discovery.detail };
  }
  const memory = await ResearchMemory.create();
  const markovian = await loadMarkovian();
  return {
    dataSource: dataSourceFromEnv(),
    memoryDir: memory.dir,
    engines: { hmem: memory.engineSource, markovian: markovian.source },
    model,
    problems,
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(INDEX_HTML));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/status") return send(200, await serialized(status));
  if (req.method === "GET" && url.pathname === "/api/memories") {
    return send(200, await serialized(async () => (await ResearchMemory.create()).listResearchFindings()));
  }
  if (req.method === "GET" && url.pathname === "/api/audit") {
    const id = url.searchParams.get("id") ?? "";
    if (!/^mem-\d+$/.test(id)) throw new HttpError(400, "id must look like mem-N");
    return send(200, await serialized(async () => (await ResearchMemory.create()).auditResearchMemory(id)));
  }
  if (req.method === "GET" && url.pathname === "/api/evidence") {
    return send(200, await createResearchRepository().findPostQuantumTraceableEvidence());
  }
  if (req.method === "POST" && url.pathname === "/api/ask") {
    const body = await readJson(req);
    const question = questionFrom(body);
    const useMemory = body.useMemory !== false;
    const learn = body.learn !== false;
    return send(200, await serialized(() => runResearchAgent(question, { useMemory, learn })));
  }
  if (req.method === "POST" && url.pathname === "/api/compare") {
    const question = questionFrom(await readJson(req));
    return send(200, await serialized(() => compareColdWarm(question)));
  }
  throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
}

export async function startUiServer(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const code = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`ResearchOS UI: http://127.0.0.1:${port}  (Ctrl+C to stop)`);
  return server;
}
