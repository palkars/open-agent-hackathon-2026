Yes. The fact-check idea fits Track 2, and it is buildable in the time left if you keep the investigation you already have and treat reverse image search as one optional evidence source. A general fact-checker plus live reverse image search will not score well on impact.

The resource at that link is behind a sign-in wall, so this is based on the live event page and on ResearchOS as it stands in `build-oct26/research-os`.

## Track 2 is the explain-why track

The official Track 2 statement is **The Agent That Can Explain Why**: investigate a complex question across multiple data sources, connect the findings, and produce an evidence-backed answer or recommendation. The organizer’s own example is a business owner asking why sales dropped, and getting an investigation with evidence instead of a guess.

Your pipeline is that job:

1. Take one claim.
2. Pull evidence from more than one source.
3. Group that evidence into clusters.
4. Have the model judge each cluster from the cited rows only.
5. Decide whether the claim holds, and say why, including the cluster that disagrees.

Track 3, **Reasoning Architecture**, is a different bar: a novel way to turn data, knowledge, memory, and reasoning into reliable decisions and actions. A cluster-then-verdict fact-check is an investigation product. Pitch it as Track 2.

## Impact is 30 of 100, and it is about a real user

The live event page scores **Impact at 30**: consistency with the challenge statement, and how effectively the solution addresses a meaningful problem for its intended users. The rest of the published split is technical implementation 20, innovation 15, demo 15, product and UX 10, and sponsor technology 10.

Impact is lost if the demo is “an LLM read some text and said true.” It is also lost if the only corpus is the current mock paper table in `build-oct26/research-os/data/papers.csv` (`source_type` is `MOCK`, URLs are `mock://researchos/...`). Judges can see that the agent never investigated anything a person would rely on.

Impact is won with four things the demo can show in one pass:

- **A named user.** A news editor, a researcher, or a compliance reviewer who must decide whether to rely on a claim.
- **Real evidence through Zetaris.** A small table of real snippets, paper abstracts, or dated reports, each with an id the verdict is allowed to cite.
- **A visible chain.** Claim, then clusters, then each cluster’s stance with source ids, then one verdict: supported, contradicted, mixed, or insufficient, plus a recommendation such as “do not publish” or “revise the prior conclusion.”
- **Memory of the last check.** Run the same claim again. H-MEM recalls the prior verdict, and the contradiction evaluator says whether the new evidence supports it or says to revise it. That second run is the agent doing work, and it matches the challenge statement directly.

`ContradictionEvaluator` already returns `SUPPORTS`, `CONTRADICTS`, `EXTENDS`, or `UNRELATED`, with source ids, a confidence, a reason, and a recommendation. `ResearchAgent` already recalls H-MEM, queries Zetaris, reasons with Nemotron through Nightshift, and stores the conclusion. Clustering is the missing middle step, not a new product.

## What to build, and what to leave out of the live demo

Submission closes **27 October 2026, 23:45 UTC**. The four-pane UI in the current plan is still open. There is enough time for a narrow Track 2 demo on this agent. There is not enough time for open-web fact-checking.

Keep this path:

- One claim in, one verdict out.
- Evidence from Zetaris, plus prior conclusions from H-MEM.
- Group rows with a simple, inspectable rule (same stance, same source, or overlapping source ids). A deterministic grouping is enough.
- One Nemotron call per cluster, restricted to ids that were actually retrieved. You already reject invented source ids in the reasoner. Keep that.
- One synthesis call that only sees those cluster opinions.
- Store the verdict in H-MEM.
- UI panes labeled with their source: claim, clusters, Zetaris rows, H-MEM contradiction, Markovian trace.

Reverse image search does not earn the 10 sponsor points. Those come from Zetaris for the evidence, H-MEM for the prior check, Markovian for the capped investigation, and Nemotron for the cluster opinions. Use an image only for one prepared claim: a cached reverse-search result stored as Zetaris rows, with the image and the pages it matched shown beside the cluster that cites them. If that lookup fails live, the text claim still produces a verdict.

The demo that scores is two scripted claims: one the evidence supports, one it contradicts, then a repeat of the first so memory and the contradiction report are on screen.