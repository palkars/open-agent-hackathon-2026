# ResearchOS demo script

About 2 minutes. Stay inside the 1 to 4 minute limit. Record one question. The take counts only when Nightshift answers it and no key or token is on screen.

## Before you record

Nightshift is running, and `GET /v1/models` on the runtime succeeds. Zetaris is up. Start the page from `build-oct26` with the LLM reasoner:

```bash
RESEARCH_REASONER=llm npx tsx research-os/ui/server.ts
```

Open the address the terminal prints, normally http://127.0.0.1:4173. If that process is already on port 4180, keep it and open http://127.0.0.1:4180. Do not restart onto a new port for the video.

Leave these off camera:

- `research-os/.env`
- the Nightshift token panel and any connect link
- a terminal that printed the runtime token or an NVIDIA key

The page itself does not show those values. Record the browser only.

## Shot 1 — the question (about 20 seconds)

Show the **Research question** box and nothing below it.

Replace the text in the box with:

> Can a Lattice Ballot collect anonymous votes without a tallying authority?

Say: "One question. ResearchOS will check prior memory and the papers in Zetaris, then say whether the evidence supports it."

## Shot 2 — one live run (about 60 seconds)

Press **Run research**. The button reads **Researching…** until Nemotron finishes. Leave the page open. A run often takes about a minute.

When the panes fill, move through them in this order:

1. **Question**, source **Nemotron**. The assessment should be **SUPPORTED**. Supporting papers should be **P232** and **P233**.
2. **Research memory**, source **H-MEM**. Claims on the left, contradictions on the right.
3. **Current evidence**, source **Zetaris**. The paper cards for P232 and P233.
4. **Agent trace**, source **Markovian**. The trace ends in a conclusion, in at most 3 chunks.

Say: "That request went through Meterless Nightshift. Nemotron returned the assessment. The NVIDIA key stayed in Nightshift."

If the page shows `ZETARIS_CONNECTION_ERROR`, `REASONING_ERROR`, `EVALUATION_ERROR`, or `MEMORY_RETRIEVAL_ERROR`, stop. Do not use that take.

If the evidence pane has no papers, stop. Zetaris is still serving an older copy. Record the trusted-opener question instead. The product slide already shows that question:

> Can post-quantum anonymity and traceability be achieved without requiring a single trusted opener?

That question is the one in the README screenshots. Its papers are P015, P020, P026, P029, and P030, and the assessment is SUPPORTED.

## Shot 3 — the engines and the tests (about 30 seconds)

Stay on the finished page. Do not run a second question.

Say: "Two Meterless engines are in this run. H-MEM is the memory that was recalled. Markovian is the trace, capped at 3 chunks. `test-markovian.ts` shows a cold run of 3 chunks and a warm run of 2, with Nightshift stopped. `test-llm-reasoner.ts` is the Nightshift request, and the source ids it prints come from the evidence that was sent."

Stop the recording there.
