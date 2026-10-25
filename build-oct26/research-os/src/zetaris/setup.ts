import { loadExperiments, loadNotes, loadPapers } from "../data/repository.ts";
import { EXPERIMENT_COLUMNS, NOTE_COLUMNS, NOTE_PAPER_COLUMNS, PAPER_COLUMNS } from "./repository.ts";
import type { ZetarisClient } from "./client.ts";

// Two ways to put the research evidence into Zetaris, both generated from
// research-os/data/*.json (re-run after editing the JSON):
//   views: schema-store views over inline Spark SQL VALUES lists; needs nothing
//          but SQL, because Zetaris can't read files on a laptop.
//   files: CSV files copied into Zetaris's shared folder, registered as
//          Lightning file-store tables, the way an organisation's files would be.
// Each string in a statement list is one statement; Lightning SQL takes one per call.

type Literal = string | number | boolean | null;

export const SETUP_TABLES = ["papers", "notes", "note_papers", "experiments"] as const;
export type SetupTable = (typeof SETUP_TABLES)[number];

export const FILES_DATABASE = "researchos_files";
// A local Zetaris only lets file tables read local files under its shared
// folder (ZETARIS_LOCAL_FILE_SYTEM_ROOT_PATH in zetaris-platform's
// docker-compose.yml); every other path, including NDP File System uploads,
// is refused with "Invalid file path to access".
const SHARED_FOLDER = "/home/zetaris/customer-data/shared/researchos";
export const COPY_COMMAND = `docker cp research-os/zetaris-files/. zetaris-driver-1:${SHARED_FOLDER}`;

// Checks the CSVs are in Zetaris's shared folder (or ZETARIS_FILES_PATH) and
// returns that folder as a file:// path.
export async function findUploadedFiles(client: ZetarisClient, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const folder = (env.ZETARIS_FILES_PATH?.trim() || `file://${SHARED_FOLDER}`).replace(/\/+$/, "");
  // LIST HDFS FILES rows: name, is directory, modified, size, path.
  const listed = await client.runSql(`LIST HDFS FILES "${folder}" OPTIONS ()`);
  const present = new Set(listed.map((row) => String(row[0])));
  const missing = SETUP_TABLES.map((t) => `${t}.csv`).filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`${folder} is missing ${missing.join(", ")}. From build-oct26 run: npx tsx research-os/research.ts zetaris-export && ${COPY_COMMAND}`);
  }
  return folder;
}

function tableData(): Record<SetupTable, { columns: readonly string[]; rows: Literal[][] }> {
  const notes = loadNotes();
  return {
    papers: { columns: PAPER_COLUMNS, rows: loadPapers().map((p) => PAPER_COLUMNS.map((c) => p[c])) },
    notes: { columns: NOTE_COLUMNS, rows: notes.map((n) => NOTE_COLUMNS.map((c) => n[c])) },
    note_papers: { columns: NOTE_PAPER_COLUMNS, rows: notes.flatMap((n) => n.related_papers.map((paperId) => [n.note_id, paperId])) },
    experiments: { columns: EXPERIMENT_COLUMNS, rows: loadExperiments().map((e) => EXPERIMENT_COLUMNS.map((c) => e[c])) },
  };
}

function literal(value: Literal): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot load a non-finite number into Zetaris: ${value}`);
    return String(value);
  }
  // Spark SQL string literals escape with backslashes.
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function valuesView(container: string, view: string, columns: readonly string[], rows: Literal[][]): string {
  const head = `CREATE OR REPLACE SCHEMASTORE VIEW ${view} WITH CONTAINER ${container} AS SELECT * FROM VALUES`;
  const alias = `AS t(${columns.join(", ")})`;
  if (rows.length === 0) {
    // VALUES needs at least one row; keep the columns and return none.
    return `${head} (${columns.map(() => "CAST(NULL AS STRING)").join(", ")}) ${alias} WHERE false`;
  }
  return `${head} ${rows.map((row) => `(${row.map(literal).join(", ")})`).join(", ")} ${alias}`;
}

export function buildSetupStatements(container: string): string[] {
  const data = tableData();
  return [
    `CREATE SCHEMASTORE CONTAINER ${container}`,
    ...SETUP_TABLES.map((table) => valuesView(container, table, data[table].columns, data[table].rows)),
  ];
}

function csvField(value: Literal): string {
  if (value === null) return "";
  if (typeof value !== "string") return String(value);
  if (/[\r\n]/.test(value)) throw new Error(`CSV export does not support line breaks in values: ${JSON.stringify(value.slice(0, 60))}`);
  return `"${value.replace(/"/g, '""')}"`;
}

// One CSV per table, header row first.
export function buildCsvFiles(): { table: SetupTable; fileName: string; content: string }[] {
  const data = tableData();
  return SETUP_TABLES.map((table) => ({
    table,
    fileName: `${table}.csv`,
    content: [data[table].columns.join(","), ...data[table].rows.map((row) => row.map(csvField).join(","))].join("\n") + "\n",
  }));
}

// Registers the uploaded CSVs as file-store tables, then clears their cached
// metadata so a re-upload is read fresh.
export function buildFileTableStatements(database: string, folder: string): string[] {
  return [
    `CREATE LIGHTNING DATABASE ${database} DESCRIBE BY "ResearchOS evidence files"`,
    ...SETUP_TABLES.map(
      (table) =>
        `CREATE LIGHTNING FILESTORE TABLE ${table} FROM ${database} FORMAT CSV OPTIONS (path "${folder}/${table}.csv", header "true", inferSchema "true", escape '"')`,
    ),
    ...SETUP_TABLES.map((table) => `UNCACHE LIGHTNING FILESTORE TABLE ${table} FROM ${database}`),
  ];
}
