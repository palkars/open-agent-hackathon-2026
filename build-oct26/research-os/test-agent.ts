// End-to-end checks for Phases 11-19, with no test framework and no network:
// the agent runs against a throwaway H-MEM store, and Zetaris and the
// Meterless Runtime are replaced by local HTTP servers that verify the exact
// requests ResearchOS sends. Live services are checked separately with
// `research.ts zetaris-check` and `research.ts provider-check`.
//
//   npx tsx research-os/test-agent.ts

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { LocalResearchRepository } from "./src/data/local-repository.ts";
import { loadNotes } from "./src/data/repository.ts";
import { ResearchMemory } from "./src/memory/research-memory.ts";
import { seedResearchNotes } from "./src/memory/seed.ts";
import { runResearchAgent } from "./src/agents/research-agent.ts";
import { propositionOf } from "./src/agents/evaluator.ts";
import { ModelClient, ProviderError, ResearchModel, normalizeMeterlessBaseUrl, parseConnectLink, resolveRoutes } from "./src/llm/provider.ts";
import type { ChatMessage } from "./src/llm/provider.ts";
import { ZetarisClient } from "./src/zetaris/client.ts";
import { ZetarisResearchRepository, crossSourceSql } from "./src/zetaris/repository.ts";
import { buildCsvFiles, buildFileTableStatements, buildSetupStatements } from "./src/zetaris/setup.ts";

const QUESTION = "Can traceability work without a trusted opener?";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const results: { ok: boolean; name: string; detail: string }[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    results.push({ ok: true, name, detail: "" });
  } catch (error) {
    results.push({ ok: false, name, detail: error instanceof Error ? error.message : String(error) });
  }
}

interface FakeServer {
  url: string;
  requests: { method: string; path: string; headers: http.IncomingHttpHeaders; body: any }[];
  close: () => Promise<void>;
}

async function fakeServer(respond: (path: string, body: any) => { status?: number; json: unknown }): Promise<FakeServer> {
  const requests: FakeServer["requests"] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf-8");
    const body = text ? JSON.parse(text) : undefined;
    requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
    const { status = 200, json } = respond(req.url ?? "", body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function freshMemory(label: string): Promise<ResearchMemory> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `research-os-${label}-`));
  const memory = await ResearchMemory.create(path.join(dir, "memory"));
  await seedResearchNotes(memory);
  return memory;
}

async function main(): Promise<void> {
  process.env.RESEARCH_OS_MARKOVIAN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "research-os-markovian-"));
  const repository = new LocalResearchRepository();

  await check("evaluator reads the trusted-opener and anonymity propositions", () => {
    assert(propositionOf("Traceable group signatures require a trusted opening authority.") === "TRUSTED_OPENER_REQUIRED", "N002 should read as REQUIRED");
    assert(propositionOf("Can traceability be achieved without a single trusted opener?") === "TRACEABLE_WITHOUT_TRUSTED_OPENER", "N003 should read as WITHOUT");
    assert(propositionOf("Traceability can be implemented using distributed threshold opening rather than one trusted opener.") === "TRACEABLE_WITHOUT_TRUSTED_OPENER", "P007 claim should read as WITHOUT");
    assert(propositionOf("Anonymous signatures appear capable of supporting traceability.") === "ANONYMITY_WITH_TRACEABILITY", "N001 should read as ANON+TRACE");
    assert(propositionOf("Lattice signatures are large.") === undefined, "unrelated text has no proposition");
  });

  await check("local cross-source query joins papers, experiments and notes", async () => {
    const rows = await repository.findPostQuantumTraceableEvidence();
    const summary = rows.map((r) => `${r.paperId}/${r.experimentId}/${r.noteId}`).join(" ");
    assert(summary === "P002/E001/N001 P002/E001/N002 P007/E002/null", `unexpected rows: ${summary}`);
  });

  await check("cold run: two Markovian chunks, grounded answer, nothing written", async () => {
    const result = await runResearchAgent(QUESTION, { useMemory: false, offline: true, repository });
    assert(result.run.chunks === 2 && result.run.status === "completed", `expected 2 completed chunks, got ${result.run.chunks} ${result.run.status}`);
    assert(result.iterations[1].carryoverIn.includes("COMPLETED:"), "chunk 2 should receive Markovian carryover state");
    assert(result.answer.startsWith("Yes.") && result.answer.includes("P007") && result.answer.includes("E002"), `answer: ${result.answer}`);
    assert(!result.learning.enabled, "cold runs must not write memory");
  });

  const memory = await freshMemory("offline");
  const n002 = memory.listResearchFindings().find((f) => f.tags.includes("note:N002"))!;

  await check("warm run: detects N002 vs P007, records the conflict and revises the belief", async () => {
    const result = await runResearchAgent(QUESTION, { memory, offline: true, repository });
    const contradiction = result.evaluations.find((e) => e.memoryId === n002.id && e.relationship === "CONTRADICTS");
    assert(contradiction && contradiction.evidence.includes("P007") && contradiction.confidence >= 0.75, "expected a decisive CONTRADICTS on the N002 memory");
    assert(result.learning.conflicts.some((c) => c.memoryId === n002.id), "conflict should be recorded");
    assert(result.learning.stored && result.learning.superseded.includes(n002.id), "a revised conclusion should supersede N002");
    const history = memory.auditResearchMemory(n002.id).history.map((e) => e.action);
    assert(history.includes("conflict_detected") && history.includes("update"), `ledger for ${n002.id}: ${history.join(", ")}`);
    assert(memory.auditResearchMemory(n002.id).current?.supersededBy === result.learning.stored!.id, "N002 should be marked supersededBy");
  });

  await check("second warm run: one chunk from the remembered conclusion, no duplicate", async () => {
    const before = memory.listResearchFindings().length;
    const result = await runResearchAgent(QUESTION, { memory, offline: true, repository });
    assert(result.run.chunks === 1, `expected 1 chunk, got ${result.run.chunks}`);
    assert(memory.listResearchFindings().length === before, "no new memory should be stored");
    assert(result.learning.skipped?.startsWith("already remembered"), `skipped: ${result.learning.skipped}`);
  });

  await check("Meterless provider: URL normalisation, connect links, placeholder token", () => {
    for (const input of ["127.0.0.1:8088", "http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1/chat/completions", "127.0.0.1:8088/v1/models", "http://127.0.0.1:8088/healthz"]) {
      assert(normalizeMeterlessBaseUrl(input) === "http://127.0.0.1:8088/v1", `${input} -> ${normalizeMeterlessBaseUrl(input)}`);
    }
    const link = parseConnectLink("http://192.168.1.5:8088/connect#k=abc%2F123");
    assert(link?.baseUrl === "http://192.168.1.5:8088/v1" && link.token === "abc/123", `connect link: ${JSON.stringify(link)}`);
    const placeholder = resolveRoutes({ METERLESS_RUNTIME_TOKEN: "rt-local" });
    assert(!placeholder.primary && placeholder.problems.some((p) => p.includes("rt-local")), "rt-local must be rejected");
    const routes = resolveRoutes({ METERLESS_RUNTIME_TOKEN: "t", MODEL_BASE_URL: "http://x/v1", MODEL_API_KEY: "k", NEMOTRON_MODEL: "nvidia/nemotron" });
    assert(routes.primary?.id === "meterless" && routes.fallback?.id === "direct", "Meterless must be primary, direct the fallback");
  });

  await check("Meterless provider: /v1/models status mapping and server-first errors", async () => {
    let mode = "online";
    const server = await fakeServer(() => {
      if (mode === "unauthorized") return { status: 401, json: { error: { message: "bad token" } } };
      if (mode === "down") return { status: 502, json: {} };
      if (mode === "refusal") return { status: 409, json: { error: { message: "No lane seated", code: "class_no_route" }, meterless: { fix: ["Seat a Nemotron lane"] } } };
      return { json: { data: [{ id: "meterless/auto" }, { id: "meterless/deep" }] } };
    });
    try {
      const client = new ModelClient({ id: "meterless", baseUrl: `${server.url}/v1`, token: "secret", model: "meterless/auto" });
      assert((await client.discover()).status === "online", "200 with meterless ids is online");
      mode = "unauthorized";
      assert((await client.discover()).status === "unauthorized", "401 is unauthorized, not offline");
      mode = "down";
      assert((await client.discover()).status === "offline", "502 is offline");
      mode = "refusal";
      const error = await client.chat([{ role: "user", content: "hi" }]).catch((e) => e);
      assert(error instanceof ProviderError && !error.transport, "a typed refusal is not a transport failure");
      assert(error.message.startsWith("No lane seated") && error.message.includes("Seat a Nemotron lane"), `message: ${error.message}`);
      const modelsRequest = server.requests.find((r) => r.method === "GET")!;
      assert(modelsRequest.headers["meterless-app"] === "research-os" && modelsRequest.headers["meterless-scope"] === undefined, "discovery sends meterless-app only");
    } finally {
      await server.close();
    }
  });

  await check("model route falls back only when the runtime can't be reached", async () => {
    const direct = await fakeServer(() => ({ json: { choices: [{ message: { role: "assistant", content: "ready" } }] } }));
    try {
      const unreachable = new ModelClient({ id: "meterless", baseUrl: "http://127.0.0.1:9/v1", token: "t", model: "meterless/auto" });
      const fallback = new ModelClient({ id: "direct", baseUrl: `${direct.url}/v1`, token: "k", model: "nvidia/nemotron" });
      const model = new ResearchModel(unreachable, fallback);
      const reply = await model.chat([{ role: "user", content: "ping" }]);
      assert(reply.content === "ready" && model.lastRoute?.id === "direct" && model.fallbackEvents.length === 1, "should fall back on a transport failure");
    } finally {
      await direct.close();
    }
  });

  await check("model mode: Nemotron drives the tools; ungrounded citations are dropped", async () => {
    const modelMemory = await freshMemory("model");
    const target = modelMemory.listResearchFindings().find((f) => f.tags.includes("note:N002"))!;
    const runtime = await fakeServer((_path, body) => {
      const toolResults = (body.messages as ChatMessage[]).filter((m) => m.role === "tool").length;
      const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      if (toolResults === 0) {
        return { json: { choices: [{ message: { role: "assistant", content: null, tool_calls: [
          call("c1", "search_research_memory", { query: "trusted opener" }),
          call("c2", "search_papers", { query: "traceability trusted opener" }),
        ] } }] } };
      }
      if (toolResults === 2) {
        return { json: { choices: [{ message: { role: "assistant", content: null, tool_calls: [call("c3", "get_experiments", { paper_ids: ["P007"] })] } }] } };
      }
      const final = {
        answer: "Yes: distributed threshold opening (P007) gives traceability without one trusted opener.",
        evaluations: [
          { relationship: "CONTRADICTS", memory_id: target.id, evidence: ["P007", "E002", "P999"], confidence: 0.9, reason: "P007 uses threshold opening" },
          { relationship: "supported", memory_id: null, evidence: ["P007"], confidence: 0.9, reason: "P007 answers the question" },
          { relationship: "SUPPORTS", memory_id: "mem-99", evidence: ["P007"], confidence: 0.9, reason: "invented memory" },
        ],
        learned: { content: "Distributed threshold opening provides traceability without a single trusted opener.", evidence: ["P007", "E002"], confidence: 0.9 },
      };
      return { json: { choices: [{ message: { role: "assistant", content: `<think>checking</think>P007 settles it.\n\`\`\`json\n${JSON.stringify(final)}\n\`\`\`\n[TASK_COMPLETE]` } }] } };
    });
    try {
      const model = new ResearchModel(new ModelClient({ id: "meterless", baseUrl: `${runtime.url}/v1`, token: "runtime-token", model: "meterless/auto" }));
      const result = await runResearchAgent(QUESTION, { memory: modelMemory, repository, model });
      const chat = runtime.requests[0];
      assert(chat.path === "/v1/chat/completions" && chat.headers.authorization === "Bearer runtime-token", "chat must go to /v1/chat/completions with the bearer token");
      assert(chat.headers["meterless-app"] === "research-os" && chat.headers["meterless-scope"] === "user", "chat must send meterless-app and meterless-scope: user");
      assert(chat.body.model === "meterless/auto" && chat.body.tools.some((t: any) => t.function.name === "search_research_memory"), "chat must offer the research tools");
      assert(result.mode === "model" && result.evaluationSource.startsWith("model") && result.run.chunks === 1, `mode ${result.mode}, source ${result.evaluationSource}, chunks ${result.run.chunks}`);
      const contradiction = result.evaluations.find((e) => e.memoryId === target.id);
      assert(contradiction && contradiction.by === "model" && !contradiction.evidence.includes("P999"), "the model's evaluation is kept, minus the ungrounded P999 citation");
      assert(!result.evaluations.some((e) => e.memoryId === "mem-99"), "an evaluation of an unseen memory must be dropped");
      assert(result.evaluations.some((e) => e.memoryId === null && e.relationship === "SUPPORTS" && e.by === "model"), "\"supported\" should be read as SUPPORTS");
      assert(result.notes.some((n) => n.includes("P999")), "the dropped citation should be reported");
      assert(result.learning.stored?.content.startsWith("Distributed threshold opening") && result.learning.superseded.includes(target.id), "the model's conclusion should revise N002");
      assert(!result.iterations[0].content.includes("<think>"), "thinking must be stripped");
    } finally {
      await runtime.close();
    }
  });

  await check("model mode: rules catch a contradiction the model didn't judge", async () => {
    const modelMemory = await freshMemory("model-gap");
    const target = modelMemory.listResearchFindings().find((f) => f.tags.includes("note:N002"))!;
    const runtime = await fakeServer((_path, body) => {
      const toolResults = (body.messages as ChatMessage[]).filter((m) => m.role === "tool").length;
      if (toolResults === 0) {
        const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
        return { json: { choices: [{ message: { role: "assistant", content: null, tool_calls: [
          call("c1", "search_papers", { query: "traceability trusted opener" }),
          call("c2", "get_experiments", { paper_ids: ["P001", "P002", "P007"] }),
        ] } }] } };
      }
      // Judges only the question, as Nemotron did in a live run.
      const final = { answer: "Yes (P007).", evaluations: [{ relationship: "SUPPORTS", memory_id: null, evidence: ["P007", "E002"], confidence: 0.85, reason: "P007" }], learned: null };
      return { json: { choices: [{ message: { role: "assistant", content: `\`\`\`json\n${JSON.stringify(final)}\n\`\`\`\n[TASK_COMPLETE]` } }] } };
    });
    try {
      const model = new ResearchModel(new ModelClient({ id: "direct", baseUrl: `${runtime.url}/v1`, token: "k", model: "nvidia/nemotron" }));
      const result = await runResearchAgent(QUESTION, { memory: modelMemory, repository, model });
      const filled = result.evaluations.find((e) => e.memoryId === target.id && e.relationship === "CONTRADICTS");
      assert(result.evaluationSource === "model+rules" && filled?.by === "rules", `source ${result.evaluationSource}, filled ${JSON.stringify(filled)}`);
      assert(result.learning.conflicts.some((c) => c.memoryId === target.id), "the rules' contradiction must still be recorded in H-MEM");
    } finally {
      await runtime.close();
    }
  });

  await check("model mode: a final chunk with no answer gets a reminder, then the rules' answer", async () => {
    const modelMemory = await freshMemory("model-silent");
    const target = modelMemory.listResearchFindings().find((f) => f.tags.includes("note:N002"))!;
    let reminders = 0;
    const runtime = await fakeServer((_path, body) => {
      const messages = body.messages as ChatMessage[];
      const last = messages.at(-1);
      if (last?.role === "user" && String(last.content).startsWith("Now write the final answer")) {
        reminders++;
        return { json: { choices: [{ message: { role: "assistant", content: "" } }] } };
      }
      if (messages.some((m) => m.role === "tool")) {
        // Ends with nothing but the completion marker, as Nemotron did live.
        return { json: { choices: [{ message: { role: "assistant", content: "[TASK_COMPLETE]" } }] } };
      }
      const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      return { json: { choices: [{ message: { role: "assistant", content: null, tool_calls: [
        call("c1", "search_papers", { query: "traceability trusted opener" }),
        call("c2", "get_experiments", { paper_ids: ["P001", "P002", "P007"] }),
      ] } }] } };
    });
    try {
      const model = new ResearchModel(new ModelClient({ id: "direct", baseUrl: `${runtime.url}/v1`, token: "k", model: "nvidia/nemotron" }));
      const result = await runResearchAgent(QUESTION, { memory: modelMemory, repository, model });
      assert(reminders === 1, `expected one reminder, got ${reminders}`);
      assert(result.answer.startsWith("Yes.") && result.answer.includes("P007"), `answer: ${JSON.stringify(result.answer)}`);
      assert(result.learning.stored && result.learning.superseded.includes(target.id), "the rules' conclusion should still revise N002");
    } finally {
      await runtime.close();
    }
  });

  await check("Zetaris client: documented REST request and typed row mapping", async () => {
    const local = await repository.findPostQuantumTraceableEvidence();
    const zetaris = await fakeServer((_path, body) => {
      if (body.sql === crossSourceSql("researchos")) {
        // REST returns every value as a string.
        return { json: { data: local.map((r) => [r.paperId, r.title, r.method, String(r.trustedOpenerRequired), r.experimentId, r.verifyTimeMs === null ? null : String(r.verifyTimeMs), r.noteId, r.noteText]) } };
      }
      if (String(body.sql).startsWith("SELECT e.experiment_id")) {
        return { json: { data: [["E002", "P007", "ThresholdLatticeSig", "3", "1.72E4", "11.3", "4.8", "PASS"]] } };
      }
      return { status: 401, json: { message: "invalid token" } };
    });
    try {
      const client = new ZetarisClient({ restUrl: `${zetaris.url}/api/v1.0`, orgId: "1", apiKey: "zk", limit: 1000 });
      const repo = new ZetarisResearchRepository(client, "researchos");
      const rows = await repo.findPostQuantumTraceableEvidence();
      assert(JSON.stringify(rows) === JSON.stringify(local), "Zetaris rows must map to the same shape as the local join");
      const [experiment] = await repo.getExperiments(["P007"]);
      assert(experiment.signature_size_bytes === 17200 && experiment.sign_time_ms === 11.3, "exponent strings must become numbers");
      const request = zetaris.requests[0];
      assert(request.path === "/api/v1.0/sql-editor/sqls/run" && request.method === "POST", `request ${request.method} ${request.path}`);
      assert(request.headers.authorization === "Bearer zk" && request.headers["x-org-id"] === "1", "bearer key and X-Org-ID required");
      assert(UUID.test(String(request.headers["x-request-id"])) && UUID.test(request.body.queryId), "X-Request-ID and queryId must be UUIDs");
      assert(request.body.source === "SqlEditor" && request.body.limit === 1000, "body must carry source and limit");
      const denied = await repo.getPapers(["P001"]).catch((e) => e as Error);
      assert(denied instanceof Error && denied.message.includes("401") && denied.message.includes("ZETARIS_API_KEY"), `401 message: ${denied}`);
      const injected = await repo.getPapers(["P001'; DROP"]).catch((e) => e as Error);
      assert(injected instanceof Error && injected.message.includes("invalid record id"), "IDs must be validated before reaching SQL");
    } finally {
      await zetaris.close();
    }
  });

  await check("Zetaris setup: one statement per table, escaped literals", () => {
    const statements = buildSetupStatements("researchos");
    assert(statements.length === 5 && statements[0] === "CREATE SCHEMASTORE CONTAINER researchos", "container plus four views");
    // Semicolons inside quoted text are fine; one between statements is not.
    const outsideQuotes = (s: string) => s.replace(/'(?:\\.|[^'\\])*'/g, "''");
    assert(statements.every((s) => !outsideQuotes(s).includes(";")), "Lightning SQL takes one statement per call");
    assert(statements[1].includes("'P007'") && statements[1].includes("AS t(paper_id, title"), "papers view should inline the rows");
    assert(statements[3].includes("('N001', 'P001')"), "note_papers should link notes to papers");
  });

  await check("Zetaris file tables: CSV export and FILESTORE statements", () => {
    const files = buildCsvFiles();
    const papers = files.find((f) => f.table === "papers")!;
    assert(files.length === 4 && papers.content.startsWith("paper_id,title,year,"), "four CSVs, header row first");
    assert(papers.content.includes('"P007","Distributed Opening for Post-Quantum Group Signatures",2026,') && papers.content.includes(",true,true,true,false,"), "strings quoted, numbers and booleans bare");
    const links = loadNotes().reduce((sum, n) => sum + n.related_papers.length, 0);
    assert(files.find((f) => f.table === "note_papers")!.content.trimEnd().split("\n").length === links + 1, "note_papers flattens each note's papers");
    const statements = buildFileTableStatements("researchos_files", "file:///data/researchos");
    assert(statements[1] === `CREATE LIGHTNING FILESTORE TABLE papers FROM researchos_files FORMAT CSV OPTIONS (path "file:///data/researchos/papers.csv", header "true", inferSchema "true", escape '"')`, statements[1]);
  });

  for (const { ok, name, detail } of results) console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n     ${detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
