# ResearchOS

ResearchOS answers one research question by recalling prior findings, querying current papers, and returning a single assessment: `SUPPORTED`, `CONTRADICTED`, `MIXED`, or `INSUFFICIENT`. Every cited paper id has to come from the memories or the evidence that were sent with that question.

The product guide, screenshots, setup, and the rest of the test list are in the [ResearchOS README](build-oct26/research-os/README.md). Commands below are run from `build-oct26`.

## How Zetaris is integrated

Zetaris is the live source of papers, notes, and experiments for a research run.

`ZetarisClient` (`build-oct26/research-os/src/zetaris/client.ts`) talks to a local Zetaris instance:

1. It reads `ZETARIS_BASE_URL` (default `http://127.0.0.1:3000`), `ZETARIS_ORG_ID`, and either `ZETARIS_API_KEY` or `ZETARIS_USERNAME` plus `ZETARIS_PASSWORD`.
2. With a username and password it logs in at `POST /api/auth/login` and keeps the access token. An API key is sent as the bearer token directly.
3. Every later call sends `Authorization: Bearer …` and `X-Org-ID`.
4. `GET /api/proxy/lightning-database/databases` checks that the org is reachable.
5. `POST /api/proxy/sql-editor/sqls/run-query` runs the SQL.

`ZetarisResearchRepository` (`build-oct26/research-os/src/zetaris/repository.ts`) queries the `research_os` schema. A research chunk calls one of these, and only for a query that Markovian has not already recorded as completed:

| Method | What it loads |
|---|---|
| `findPostQuantumAnonymousTraceableSchemes` | Papers joined to experiments where the family is post-quantum, anonymity and traceability are true, and a trusted opener is not required |
| `getPaperEvidence` | One paper, its notes, and its experiments, by paper id |
| `getPotentiallyConflictingEvidence` | Papers joined to skeptical notes, with any experiment result |
| `findEvidenceForClaim` | Papers, notes, and experiments selected for the wording of the question |

Install and connection steps are in [docs/zetaris-local-install.md](docs/zetaris-local-install.md) and [docs/connect-researchos-to-zetaris.md](docs/connect-researchos-to-zetaris.md).

**Test.** Zetaris must be up. From `build-oct26`:

```bash
npx tsx research-os/test-zetaris.ts
```

The script logs in, runs `SELECT 1`, prints `Zetaris connection: OK`, loads paper `P020` with its note and experiment, and prints the post-quantum anonymous traceable schemes. It exits with an error if any of those result sets is empty.

## Meterless engines

Two Meterless reference engines are vendored and called on every research run. H-MEM is loaded through `build-oct26/src/engine.ts` from `build-oct26/vendor/hmem` and persisted in `build-oct26/research-os/.memory`. Markovian is imported from `build-oct26/research-os/vendor/markovian`. The offline test below imports the copies under `build-oct26/research-os/vendor`.

### H-MEM

H-MEM is the research memory. `ResearchMemory` recalls prior findings with `query`, stores a conclusion with `add` (claim, limitation, contradiction, or open question), and reads append-only history with the trust ledger. On a warm run the recall text is passed into Markovian as `memoryContext`, so the first chunk already contains `[MEMORY CONTEXT]` and does not search memory again.

### Markovian

Markovian carries the investigation from chunk to chunk. The run uses `mode: RESEARCH`, reflection off, `chunkSize` 2000, `maxChunks` 3, and `carryoverTokens` 128. Each chunk receives `COMPLETED`, `REMAINING`, `DECISIONS`, and `CONTEXT`, queries Zetaris once for work that is not already completed, and asks the reasoner to assess only that chunk plus the evidence gathered so far. The loop stops when the assessment is sufficient, when no further Zetaris query exists, or at chunk 3.

**Test.** No network. Nightshift can be stopped. From `build-oct26`:

```bash
npx tsx research-os/test-markovian.ts
```

The script builds the warm reinjection with H-MEM, then runs the same goal through Markovian twice. The cold run has no memory and finishes in 3 chunks. The warm run is given that H-MEM reinjection, marks the settled step already resolved, and finishes in 2 chunks. Both runs stay inside the cap, carry the four state fields, and leave reflection off. The script prints `pass` when that holds.

H-MEM recall on the persisted store is also exercised with:

```bash
npx tsx research-os/test-memory.ts ask "trusted opener"
```

## How the app connects to Meterless Nightshift

Nightshift is the only model call. The NVIDIA key stays in Nightshift under Setup, then Providers, then NVIDIA. ResearchOS sends the runtime token.

`completeMeterless` in `build-oct26/research-os/src/reasoning/llm-reasoner.ts` does the following when `LLM_PROVIDER=meterless`:

1. Requires `METERLESS_RUNTIME_TOKEN`. An empty token and the placeholder `rt-local` are rejected.
2. Normalizes `METERLESS_BASE_URL` to a `/v1` base. The configured default is `http://127.0.0.1:8088/v1`. If that origin does not answer `GET /healthz`, it tries ports 8088, 8090, 8787, and 11434 on the same host.
3. Calls `GET /v1/models` with `Authorization: Bearer <runtime token>`, `meterless-app: research-os`, and `meterless-scope: user`.
4. Selects `METERLESS_MODEL`. This project pins `nvidia/nemotron-3.5-lightning-30b-a3b`. If that variable is unset, the client prefers the same NVIDIA id from the model list.
5. Posts the assessment to `POST /v1/chat/completions` with temperature 0, thinking disabled, and a strict JSON schema for the conclusion. A schema rejection is retried as a JSON object, then as a repair turn.

`GET /healthz` only means the process is up. `GET /v1/models` is the check that the runtime can serve a model.

**Test.** Nightshift must be running, `GET /v1/models` must succeed, and Zetaris must be up. From `build-oct26`:

```bash
npx tsx research-os/test-llm-reasoner.ts
```

The script loads H-MEM, queries Zetaris for the trusted-opener question, and sends that context through Nightshift once. It prints the assessment, summary, confidence, supporting ids, conflicting ids, open questions, and the valid source ids from the evidence that was sent. Supporting and conflicting ids are accepted only when they appear in that valid list.

## Where NVIDIA technology contributes

NVIDIA Nemotron is the reasoner. The model id is `nvidia/nemotron-3.5-lightning-30b-a3b`, served by Nightshift from the NVIDIA provider key created at [build.nvidia.com](https://build.nvidia.com).

Nemotron is called in two places:

- **Assessment.** `LLMResearchReasoner` asks for `SUPPORTED`, `CONTRADICTED`, `MIXED`, or `INSUFFICIENT`, a summary, a confidence from 0 to 1, source ids, and open questions. The instruction limits the model to the supplied H-MEM memories and Zetaris rows.
- **Contradiction check.** `ContradictionEvaluator` asks Nemotron whether each recalled memory `SUPPORTS`, `EXTENDS`, `CONTRADICTS`, or is `UNRELATED` to the Zetaris evidence, and checks the ids it returns.

`test-llm-reasoner.ts` is the assessment call. `test-evaluator.ts` plants a belief that a trusted opener is still required and checks that Nemotron marks it `CONTRADICTS` with the recommendation `Revise existing conclusion.` That second test also needs Nightshift and Zetaris.

```bash
npx tsx research-os/test-evaluator.ts
```

## What is unique about this use of the sponsor technologies

The four sponsors sit on one bounded investigation, and each one owns a different fact.

H-MEM text is injected into the first Markovian chunk. A warm run therefore spends a chunk less than a cold run: the settled step is already resolved, which `test-markovian.ts` shows as 2 chunks against 3. Later chunks carry only `COMPLETED`, `REMAINING`, `DECISIONS`, and `CONTEXT`, and they search H-MEM again for what is still open.

Markovian is capped at 3 chunks. Each chunk asks Zetaris once, for a paper, a scheme search, or a conflict search that is still open. Those Zetaris rows are the current evidence. Nemotron judges only the H-MEM hits and the Zetaris rows sent with the chunk, and a paper id is accepted only when it appears in that context. After the last chunk, the same model compares those memories with those rows, and the conclusion is written back into H-MEM once.

Papers, H-MEM, and Markovian stay on the machine. The NVIDIA key stays in Nightshift. The only outbound model call is the local Nightshift runtime, which is what serves Nemotron.
