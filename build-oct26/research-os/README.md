# ResearchOS

A research agent that keeps two things apart:

- **Research evidence** ("what exists?"): papers, experiments and researcher notes, served by **Zetaris** (or local JSON as a fallback).
- **Research memory** ("what have we learned?"): the researcher's claims, open questions and revised conclusions, kept in **H-MEM** with provenance and an append-only audit ledger.

Ask a question and the agent recalls what you already believe, gathers evidence in bounded **Markovian** steps, checks the evidence against your beliefs, and writes what it learned back to memory. When evidence contradicts a belief, the belief is kept, marked as superseded, and every step is in its ledger.

## Where each sponsor technology is used

| Layer | Used for | Code |
|---|---|---|
| Zetaris (Data) | Evidence tables queried over the REST API; one cross-source SQL join; optional `run_sql` tool for the model | `src/zetaris/` |
| H-MEM (Meterless Engine) | Research memory: storage with provenance, hybrid retrieval, reinjection context, conflict entries, supersede, feedback, audit | `src/memory/research-memory.ts` |
| Markovian (Meterless Engine) | Each agent iteration is one chunk; H-MEM context enters chunk 0; only the bounded carryover state reaches later chunks; run history in `.markovian/` | `src/agents/research-agent.ts` |
| Meterless Runtime + Nemotron (Power) | Primary model route (provider contract v4); the model drives the research tools | `src/llm/provider.ts` |

## Setup

From `build-oct26/`:

```bash
npm install                 # then, on Linux after a Windows checkout: chmod +x node_modules/.bin/{tsx,tsc,esbuild}
npm run setup:markovian     # only if vendor/markovian is missing
cp .env.example .env        # fill in your values; .env is gitignored
npx tsx research-os/research.ts seed-memory
```

With nothing configured, everything still runs: evidence comes from `research-os/data/*.json` and the agent uses its offline planner and rules (labelled as such in every output).

### Zetaris

1. Install and start Zetaris (participant guide, Data 1.1–1.7), create an API key in its web interface, and put `ZETARIS_*` in `.env`.
2. Load the evidence as **CSV file tables** (what this project uses, `researchos_files`):
   ```bash
   npx tsx research-os/research.ts zetaris-export                          # writes research-os/zetaris-files/*.csv
   docker cp research-os/zetaris-files/. zetaris-driver-1:/home/zetaris/customer-data/shared/researchos
   npx tsx research-os/research.ts zetaris-setup --files                   # dry run: prints the statements
   npx tsx research-os/research.ts zetaris-setup --files --apply           # registers the tables, then checks
   ```
   Re-run all four after editing the JSON. A local Zetaris only lets file tables read local files under its `customer-data/shared` folder; uploads through the NDP File System page land elsewhere and are refused ("Invalid file path to access"), and the bundled samples read from S3. The `docker cp` step is why.

   Alternative without files: `zetaris-setup --apply` (no `--files`) creates schema-store views in a `researchos` container, with the rows written into each view's definition.
3. Set `DATA_SOURCE=zetaris` and `ZETARIS_RESEARCH_CONTAINER=researchos_files` (or `researchos` for the views) in `.env`, then `npx tsx research-os/research.ts zetaris-check`.
4. In the Zetaris UI the tables are under **Data Explorer → File Source & API → researchos_files**; query them in **Workbench → SQL Workspace**, one statement per run.

### Meterless Nightshift and Nemotron

1. Install Nightshift, add your NVIDIA key in its Providers tab, and give a lane a Nemotron model (participant guide, Power 4.2–4.4).
2. Copy the Runtime URL and API key from Nightshift's Console into `METERLESS_BASE_URL` and `METERLESS_RUNTIME_TOKEN`.
3. `npx tsx research-os/research.ts provider-check` lists the routes the runtime offers and sends one text request. Set `METERLESS_MODEL` to a Nemotron-backed route so the NVIDIA award evidence is unambiguous.

## Commands

```bash
npx tsx research-os/research.ts search "traceability"        # full-text paper search (DATA_SOURCE)
npx tsx research-os/research.ts evidence                     # cross-source query (DATA_SOURCE)
npx tsx research-os/research.ts memory "trusted opener"      # H-MEM retrieval
npx tsx research-os/research.ts memories                     # every finding, with supersede links
npx tsx research-os/research.ts audit mem-2                  # a memory's ledger
npx tsx research-os/research.ts ask "Can traceability work without a trusted opener?"
npx tsx research-os/research.ts ask "..." --cold --no-learn --offline
npx tsx research-os/research.ts compare "..."                # cold vs warm, no memory writes
npx tsx research-os/research.ts ui                           # http://127.0.0.1:4317
```

## Two-minute demo

```bash
export RESEARCH_OS_MEMORY_DIR=/tmp/research-os-demo   # optional: a fresh memory store
npx tsx research-os/research.ts seed-memory
npx tsx research-os/research.ts ask "Can traceability work without a trusted opener?"
#   -> P007 + E002 contradict note N002; conflict_detected; a revised conclusion supersedes it
npx tsx research-os/research.ts audit mem-2               # create, read, conflict_detected, update supersededBy
npx tsx research-os/research.ts compare "Can traceability work without a trusted opener?"
#   -> cold: 2 chunks; warm: 1 chunk, because memory already holds the conclusion
```

## Tests

```bash
npx tsx research-os/test-memory.ts remember && npx tsx research-os/test-memory.ts ask "trusted opener"
npx tsx research-os/test-agent.ts
```

`test-agent.ts` runs the agent on a throwaway memory store and replaces Zetaris and the Meterless Runtime with local HTTP servers that check the exact requests sent (headers, UUIDs, tool calls). It proves the contracts, not a live connection: use `zetaris-check` and `provider-check` for that.

## Limits to know about

- **Live models vary between runs.** With Nemotron (`nvidia/nemotron-3.5-lightning-30b-a3b`) a run takes 1–3 chunks and roughly 45–130 s. The model doesn't always judge every memory or write the final json block, so the offline rules act as a verification lane: they judge any memory the model skipped, supply the answer and conclusion when the model gives none, and every evaluation is labelled `[model]` or `[rules]`.
- **Offline evaluation is narrow.** Without a model, the rules only judge claims about trusted openers, traceability and anonymity, the attributes the evidence records. Open-ended questions need the model route.
- **H-MEM retrieval is not semantic.** The vendored H-MEM reference uses a hash-based mock embedder, and every memory gets a baseline score, so recall can include unrelated findings. The evaluator marks those UNRELATED rather than treating them as evidence.
- **Not yet run against live services.** The Zetaris views and the Nightshift route are built to the documented contracts but haven't been run against a real instance.
- **Feedback accumulates.** Each run that confirms a belief raises its confidence by 0.05 (H-MEM's `helpful` feedback); `compare` never writes.
