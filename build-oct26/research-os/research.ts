import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./src/env.ts";
import { createResearchRepository, dataSourceFromEnv } from "./src/data/research-repository.ts";
import { ResearchMemory } from "./src/memory/research-memory.ts";
import type { ResearchFinding } from "./src/memory/research-memory.ts";
import { seedResearchNotes } from "./src/memory/seed.ts";
import { compareColdWarm, runResearchAgent } from "./src/agents/research-agent.ts";
import { formatAgentResult, formatComparison } from "./src/agents/report.ts";
import { ModelClient, autoDetectMeterless, resolveRoutes } from "./src/llm/provider.ts";
import { ZetarisClient, zetarisConfigFromEnv } from "./src/zetaris/client.ts";
import { crossSourceSql, zetarisContainerFromEnv } from "./src/zetaris/repository.ts";
import { COPY_COMMAND, FILES_DATABASE, SETUP_TABLES, buildCsvFiles, buildFileTableStatements, buildSetupStatements, findUploadedFiles } from "./src/zetaris/setup.ts";

const EXPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "zetaris-files");

function printFinding(finding: ResearchFinding, heading: string): void {
  console.log(`${finding.id}  ${finding.type}  ${heading}`);
  console.log(`  ${finding.content}`);
  console.log(`  confidence: ${finding.confidence}`);
  const refs = finding.sourceIds.length > 0 ? ` (refs: ${finding.sourceIds.join(", ")})` : "";
  console.log(`  source: ${finding.source}${refs}`);
  if (finding.tags.length > 0) console.log(`  tags: ${finding.tags.join(", ")}`);
  if (finding.supersededBy) console.log(`  superseded by: ${finding.supersededBy}`);
  if (finding.supersedes) console.log(`  supersedes: ${finding.supersedes}`);
}

async function openMemory(): Promise<ResearchMemory> {
  const memory = await ResearchMemory.create();
  console.log(`engine source: ${memory.engineSource} | state: ${path.relative(process.cwd(), memory.dir) || "."}`);
  return memory;
}

async function main(): Promise<void> {
  loadEnv();
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const arg = rest.filter((a) => !a.startsWith("--")).join(" ").trim();

  switch (command) {
    case "search": {
      if (!arg) return usage();
      for (const paper of await createResearchRepository().searchPapers(arg)) {
        console.log(`${paper.paper_id}\n${paper.title}\n`);
      }
      break;
    }
    case "seed-memory": {
      const report = await seedResearchNotes(await openMemory());
      console.log(`notes source: ${report.source}`);
      console.log(`processed: ${report.processed} | stored: ${report.stored} | skipped (already seeded): ${report.skipped} | failed: ${report.failed}`);
      if (report.storedIds.length > 0) console.log(`stored: ${report.storedIds.join(", ")}`);
      for (const failure of report.failures) console.error(`failed ${failure.noteId}: ${failure.error}`);
      if (report.failed > 0) process.exitCode = 1;
      break;
    }
    case "memory": {
      if (!arg) return usage();
      const result = (await openMemory()).retrieveResearchMemory(arg);
      if (result.findings.length === 0) console.log(`no research findings matched "${arg}"`);
      for (const finding of result.findings) {
        printFinding(finding, `relevance ${finding.relevance.toFixed(4)}`);
        console.log();
      }
      console.log(`trace: ${result.trace.retrievalReason} | strategy: ${result.trace.strategy}`);
      console.log(`H-MEM matches: ${result.hmemMatches} | research findings: ${result.findings.length}`);
      break;
    }
    case "memories": {
      const findings = (await openMemory()).listResearchFindings();
      if (findings.length === 0) console.log("research memory is empty: run seed-memory");
      for (const finding of findings) {
        printFinding(finding, finding.supersededBy ? "(superseded)" : "");
        console.log();
      }
      break;
    }
    case "audit": {
      if (!arg) return usage();
      // TrustLedgerService of the same persistent research-memory instance.
      const { current, history } = (await openMemory()).auditResearchMemory(arg);
      if (history.length === 0) throw new Error(`no ledger entries for ${arg} in research memory`);
      if (current) printFinding(current, "(current)");
      else console.log(`${arg}: not currently stored as a research finding`);
      console.log(`\nledger (${history.length} entries):`);
      for (const e of history) {
        const conf = e.newState?.confidence !== undefined ? ` confidence ${e.previousState?.confidence ?? "-"} -> ${e.newState.confidence}` : "";
        const superseded = e.newState?.supersededBy ? ` supersededBy -> ${e.newState.supersededBy}` : "";
        const details = e.details ? ` ${JSON.stringify(e.details)}` : "";
        console.log(`- ${e.action} by ${e.actor} at ${new Date(e.timestamp).toISOString()}${conf}${superseded}${details}`);
      }
      break;
    }
    case "evidence": {
      // Phase 13: one cross-source query, from JSON or Zetaris per DATA_SOURCE.
      const repository = createResearchRepository();
      console.log(`evidence source: ${repository.source}`);
      console.log("post-quantum schemes with anonymity + traceability, their experiments and the notes citing them:\n");
      const rows = await repository.findPostQuantumTraceableEvidence();
      for (const paperId of [...new Set(rows.map((r) => r.paperId))]) {
        const paperRows = rows.filter((r) => r.paperId === paperId);
        const first = paperRows[0];
        console.log(`${first.paperId}  ${first.title}`);
        console.log(`  method: ${first.method} | trusted opener required: ${first.trustedOpenerRequired}`);
        const experiments = [...new Map(paperRows.filter((r) => r.experimentId).map((r) => [r.experimentId, r])).values()];
        for (const r of experiments) console.log(`  experiment ${r.experimentId}: verify ${r.verifyTimeMs} ms`);
        const notes = [...new Map(paperRows.filter((r) => r.noteId).map((r) => [r.noteId, r])).values()];
        for (const r of notes) console.log(`  note ${r.noteId}: ${r.noteText}`);
        if (notes.length === 0) console.log("  no researcher note cites this paper yet");
        console.log();
      }
      if (rows.length === 0) console.log("no rows");
      break;
    }
    case "ask": {
      if (!arg) return usage();
      const result = await runResearchAgent(arg, {
        useMemory: !flags.has("--cold"),
        learn: !flags.has("--no-learn"),
        offline: flags.has("--offline"),
      });
      console.log(formatAgentResult(result));
      break;
    }
    case "compare": {
      if (!arg) return usage();
      const { cold, warm } = await compareColdWarm(arg, { offline: flags.has("--offline") });
      console.log(`question: ${arg}\n`);
      console.log(formatComparison(cold, warm));
      break;
    }
    case "provider-check":
      await providerCheck();
      break;
    case "zetaris-check":
      await zetarisCheck();
      break;
    case "zetaris-setup":
      await zetarisSetup(flags.has("--apply"), flags.has("--files"));
      break;
    case "zetaris-export": {
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
      for (const file of buildCsvFiles()) {
        fs.writeFileSync(path.join(EXPORT_DIR, file.fileName), file.content, "utf-8");
        console.log(`wrote ${path.relative(process.cwd(), path.join(EXPORT_DIR, file.fileName))} (${file.content.trimEnd().split("\n").length - 1} rows)`);
      }
      console.log("\nnext, from build-oct26: copy them into Zetaris's shared folder, then register them:");
      console.log(`  ${COPY_COMMAND}`);
      console.log("  npx tsx research-os/research.ts zetaris-setup --files --apply");
      break;
    }
    case "ui": {
      const portIndex = rest.indexOf("--port");
      const port = portIndex >= 0 ? Number(rest[portIndex + 1]) : Number(process.env.RESEARCH_OS_UI_PORT ?? 4317);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a port number");
      const { startUiServer } = await import("./ui/server.ts");
      await startUiServer(port);
      return;
    }
    default:
      usage();
  }
}

async function providerCheck(): Promise<void> {
  const { primary, fallback, problems, forcedOffline } = resolveRoutes();
  for (const problem of problems) console.log(`problem: ${problem}`);
  if (forcedOffline) {
    console.log("RESEARCH_OS_MODEL_ROUTE=offline: the agent uses its offline planner and rules.");
    return;
  }
  if (!primary) {
    console.log("no model route configured: the agent runs offline (deterministic planner and rules).");
    const found = await autoDetectMeterless(process.env.METERLESS_RUNTIME_TOKEN ?? "");
    console.log(found
      ? `auto-detect: a Meterless Runtime answers at ${found.baseUrl} (${found.status}). Set METERLESS_BASE_URL=${found.baseUrl} and METERLESS_RUNTIME_TOKEN in build-oct26/.env.`
      : "auto-detect: no Meterless Runtime on 127.0.0.1/localhost/[::1] ports 8088, 8090, 8787, 11434. Start Nightshift, then copy its URL and API key from the Console.");
    process.exitCode = 1;
    return;
  }

  let primaryOnline = false;
  for (const [label, route] of [["primary", primary], ["fallback", fallback]] as const) {
    if (!route) continue;
    const client = new ModelClient(route);
    const discovery = await client.discover();
    const ids = route.id === "meterless" ? discovery.models.filter((m) => m.startsWith("meterless/")) : discovery.models;
    console.log(`${label}: ${route.id} at ${route.baseUrl}, model ${route.model} -> ${discovery.status}${discovery.detail ? ` (${discovery.detail})` : ""}`);
    if (ids.length > 0) console.log(`  models: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ", ..." : ""}`);
    if (label === "primary") primaryOnline = discovery.status === "online";
  }
  if (!primaryOnline) {
    process.exitCode = 1;
    return;
  }
  const reply = await new ModelClient(primary).chat([{ role: "user", content: "Reply with the single word: ready" }]);
  console.log(`text request on ${primary.model}: ${JSON.stringify(reply.content)}`);
}

async function zetarisCheck(container = zetarisContainerFromEnv()): Promise<void> {
  const client = new ZetarisClient(zetarisConfigFromEnv());
  console.log(`Zetaris REST: ${client.config.restUrl} (org ${client.config.orgId}) | DATA_SOURCE=${dataSourceFromEnv()}`);
  const one = await client.runSql("SELECT 1");
  console.log(`SELECT 1 -> ${JSON.stringify(one)}`);
  let missing = 0;
  for (const table of SETUP_TABLES) {
    try {
      const rows = await client.runSql(`SELECT COUNT(*) FROM ${container}.${table}`);
      console.log(`${container}.${table}: ${rows[0]?.[0]} rows`);
    } catch (error) {
      missing++;
      console.log(`${container}.${table}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (missing > 0) {
    console.log("\nsome research tables are missing: preview the setup with `zetaris-setup`, then run `zetaris-setup --apply`.");
    process.exitCode = 1;
    return;
  }
  const rows = await client.runSql(crossSourceSql(container));
  console.log(`cross-source query: ${rows.length} rows`);
}

async function zetarisSetup(apply: boolean, files: boolean): Promise<void> {
  // --files registers CSVs uploaded to NDP File System; otherwise inline-data views.
  const container = files ? FILES_DATABASE : zetarisContainerFromEnv();
  // Finding the uploaded CSVs only lists folders, so the dry run can show the path.
  const folder = files ? await findUploadedFiles(new ZetarisClient(zetarisConfigFromEnv())) : undefined;
  const statements = folder ? buildFileTableStatements(container, folder) : buildSetupStatements(container);
  if (!apply) {
    console.log(`-- Dry run: ${statements.length} Lightning SQL statements, one per call. Nothing was created.`);
    if (folder) console.log(`-- Reads the uploaded CSVs from ${folder}`);
    console.log(`-- Apply with: npx tsx research-os/research.ts zetaris-setup${files ? " --files" : ""} --apply\n`);
    for (const statement of statements) console.log(`${statement};\n`);
    if (files) console.log(`-- Afterwards set ZETARIS_RESEARCH_CONTAINER=${FILES_DATABASE} in .env to read from these tables.`);
    return;
  }
  const client = new ZetarisClient(zetarisConfigFromEnv());
  for (const statement of statements) {
    const label = statement.slice(0, 70);
    try {
      await client.runSql(statement);
      console.log(`ok       ${label}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Re-running setup is fine: the container may already exist.
      if (/already exists/i.test(message)) {
        console.log(`exists   ${label}`);
        continue;
      }
      throw new Error(`${label}...: ${message}`);
    }
  }
  await zetarisCheck(container);
  if (files && zetarisContainerFromEnv() !== container) {
    console.log(`\nResearchOS still reads ${zetarisContainerFromEnv()}: set ZETARIS_RESEARCH_CONTAINER=${container} in .env to use the file tables.`);
  }
}

function usage(): void {
  console.error(`usage:
  npx tsx research-os/research.ts search "<query>"      full-text search over papers (DATA_SOURCE)
  npx tsx research-os/research.ts evidence              cross-source query: papers + experiments + notes
  npx tsx research-os/research.ts seed-memory           store every note as a research finding (H-MEM)
  npx tsx research-os/research.ts memory "<query>"      retrieve research findings
  npx tsx research-os/research.ts memories              list every research finding
  npx tsx research-os/research.ts audit <memory-id>     trust-ledger history of one memory
  npx tsx research-os/research.ts ask "<question>"      run the research agent [--cold] [--no-learn] [--offline]
  npx tsx research-os/research.ts compare "<question>"  cold vs warm (H-MEM) run of the agent [--offline]
  npx tsx research-os/research.ts provider-check        check the Meterless Runtime / model route
  npx tsx research-os/research.ts zetaris-check         check Zetaris and the research tables
  npx tsx research-os/research.ts zetaris-setup         print the SQL that loads the data into Zetaris [--files] [--apply]
  npx tsx research-os/research.ts zetaris-export        write the data as CSVs for Zetaris file tables
  npx tsx research-os/research.ts ui [--port 4317]      local web UI

settings come from build-oct26/.env: DATA_SOURCE=local|zetaris, ZETARIS_*, METERLESS_* (see research-os/README.md)`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
