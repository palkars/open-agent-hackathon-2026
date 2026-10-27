Absolutely. Since you have cloned the **full Meterless repository** and are currently inside:

```text
Meterless/templates/agentathon-starter
```

we can build ResearchOS incrementally without breaking the supplied starter.

One important detail from the current repo: the starter is intentionally a **CLI**, not a web app. Its `notebook.ts` already gives us real H-MEM mining, retrieval, provenance, auditing, consolidation and persistence. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/templates/agentathon-starter/notebook.ts)

I would follow the sequence below exactly.

---

# Phase 0 — Make sure Meterless works before changing anything

## Step 0.1 — Check where you are

In your Cursor terminal:

```bash
pwd
ls
```

You should see roughly:

```text
README.md
notebook.ts
package.json
seed/
src/
```

Now:

```bash
node --version
npm --version
```

## Step 0.2 — Install the starter

Run:

```bash
npm install
npm run setup
```

**Do not skip `npm run setup`.**

The starter deliberately does not contain H-MEM itself. That command pulls the H-MEM reference implementation into:

```text
vendor/hmem/
```

The official README explicitly says setup is required. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/templates/agentathon-starter/README.md)

Afterwards:

```bash
ls vendor/hmem
```

should show the H-MEM implementation.

---

# Phase 1 — Prove H-MEM works

Before ResearchOS, understand the thing we're extending.

## Step 1.1 — Seed the existing notebook

Run:

```bash
npx tsx notebook.ts seed
```

You should see memories being mined.

Then:

```bash
npx tsx notebook.ts ask "what did we decide about storage"
```

The starter should retrieve memories and show provenance IDs such as:

```text
mem-1
mem-2
```

This is using H-MEM's `MemoryRetrievalService`; it's not fake retrieval. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/templates/agentathon-starter/notebook.ts)

## Step 1.2 — Store your own research fact

Try:

```bash
npx tsx notebook.ts remember "Dilithium is a lattice-based digital signature scheme standardized by NIST"
```

Then:

```bash
npx tsx notebook.ts ask "what do I know about lattice based signatures"
```

You should get the memory back.

## Step 1.3 — Test persistence

This matters for the eventual demo.

Close the terminal.

Open another terminal.

Run:

```bash
npx tsx notebook.ts ask "what do I know about lattice based signatures"
```

It should still remember.

That's because the starter creates persistent state under:

```text
.notebook/
```

The Meterless README specifically identifies this persistence as part of the intended demo. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/templates/agentathon-starter/README.md)

### CHECKPOINT 1

Don't proceed until this works:

```text
remember
    ↓
H-MEM
    ↓
close program
    ↓
restart
    ↓
ask
    ↓
memory retrieved
```

---

# Phase 2 — Create ResearchOS without destroying the starter

Leave `notebook.ts` alone initially.

We want to be able to compare our application against the original example.

Create:

```bash
mkdir -p research-os/data
mkdir -p research-os/src
mkdir -p research-os/src/data
mkdir -p research-os/src/memory
mkdir -p research-os/src/agents
mkdir -p research-os/src/zetaris
```

Your directory becomes:

```text
agentathon-starter/

├── notebook.ts
├── package.json
├── src/
├── seed/
├── vendor/
│
└── research-os/
    ├── data/
    │
    └──
    └── src/
        ├── agents/
        ├── data/
        ├── memory/
        └── zetaris/
```

---

# Phase 3 — Create our mock research data

Now we build the data **before Zetaris and before the AI agent**.

This is deliberate.

We want to know exactly what the correct answers should be.

## Step 3.1 — Papers

Create:

```text
research-os/data/papers.json
```

Start with about **10 papers**.

Don't worry about using genuine papers yet.

Structure:

```json
[
  {
    "paper_id": "P001",
    "title": "Anonymous Group Signatures for Distributed Systems",
    "year": 2023,
    "topic": "group signatures",
    "method": "classical group signature",
    "provides_anonymity": true,
    "provides_traceability": true,
    "post_quantum": false,
    "trusted_opener_required": true,
    "key_claim": "Group signatures provide signer anonymity while allowing an authorised opener to reveal the signer.",
    "limitation": "Requires a trusted opening authority."
  },
  {
    "paper_id": "P002",
    "title": "Lattice-Based Anonymous Signatures",
    "year": 2025,
    "topic": "lattice signatures",
    "method": "LWE",
    "provides_anonymity": true,
    "provides_traceability": true,
    "post_quantum": true,
    "trusted_opener_required": true,
    "key_claim": "Lattice constructions can provide post-quantum anonymity and traceability.",
    "limitation": "Large signatures."
  },
  {
    "paper_id": "P007",
    "title": "Distributed Opening for Post-Quantum Group Signatures",
    "year": 2026,
    "topic": "threshold opening",
    "method": "LWE threshold opening",
    "provides_anonymity": true,
    "provides_traceability": true,
    "post_quantum": true,
    "trusted_opener_required": false,
    "key_claim": "Traceability can be implemented using distributed threshold opening rather than one trusted opener.",
    "limitation": "Higher communication overhead."
  }
]
```

**P007 is important.**

We've deliberately planted a contradiction.

---

# Phase 4 — Create researcher notes

Create:

```text
research-os/data/notes.json
```

Example:

```json
[
  {
    "note_id": "N001",
    "date": "2026-09-10",
    "type": "conclusion",
    "text": "Anonymous signatures appear capable of supporting traceability.",
    "confidence": 0.8,
    "related_papers": ["P001", "P002"]
  },
  {
    "note_id": "N002",
    "date": "2026-09-12",
    "type": "conclusion",
    "text": "Traceable group signatures require a trusted opening authority.",
    "confidence": 0.72,
    "related_papers": ["P001", "P002"]
  },
  {
    "note_id": "N003",
    "date": "2026-09-15",
    "type": "research_question",
    "text": "Can traceability be achieved without a single trusted opener?",
    "confidence": 0.5,
    "related_papers": []
  }
]
```

Notice:

```text
N002

"requires trusted opening authority"
```

versus:

```text
P007

"distributed threshold opening"
```

That's our future demo.

---

# Phase 5 — Add experiments

Create:

```text
research-os/data/experiments.json
```

Example:

```json
[
  {
    "experiment_id": "E001",
    "paper_id": "P002",
    "scheme": "LatticeGroupSig-A",
    "security_level": 3,
    "signature_size_bytes": 14820,
    "sign_time_ms": 8.7,
    "verify_time_ms": 4.2,
    "result": "PASS"
  },
  {
    "experiment_id": "E002",
    "paper_id": "P007",
    "scheme": "ThresholdLatticeSig",
    "security_level": 3,
    "signature_size_bytes": 17200,
    "sign_time_ms": 11.3,
    "verify_time_ms": 4.8,
    "result": "PASS"
  }
]
```

Now we have three sources:

```text
papers.json
notes.json
experiments.json
```

---

# Phase 6 — Make a local data layer FIRST

Do **not connect Zetaris yet**.

This is important.

First prove our application works against local files.

Create:

```text
research-os/src/data/repository.ts
```

Its job is simply:

```text
loadPapers()
loadNotes()
loadExperiments()
searchPapers()
```

Conceptually:

```text
ResearchOS
    │
    ▼
Repository
    │
 ┌──┼────┐
 ▼  ▼    ▼
Papers Notes Experiments
```

Later we'll replace:

```text
Repository → JSON
```

with:

```text
Repository → Zetaris
```

That separation will save you enormous debugging time.

---

# Phase 7 — Your first Cursor task

Now open Cursor Chat/Agent.

**Don't tell Cursor "build the entire app."**

Give it a small task such as:

```text
Read README.md, notebook.ts and src/engine.ts.

We are extending this Meterless Agentathon starter into a
Research Memory Agent called ResearchOS.

Do not modify notebook.ts or the existing H-MEM implementation.

Create research-os/src/data/repository.ts.

It should load:
research-os/data/papers.json
research-os/data/notes.json
research-os/data/experiments.json

Expose TypeScript functions:

loadPapers()
loadNotes()
loadExperiments()
searchPapers(query)

Add appropriate TypeScript interfaces.

Do not add a database or UI.
```

Review what Cursor generates.

Then test it.

### CHECKPOINT 2

We want:

```text
JSON
 ↓
TypeScript repository
 ↓
search
 ↓
results
```

No AI yet.

No Zetaris.

No Markovian.

---

# Phase 8 — Create the first ResearchOS CLI

Now ask Cursor to create:

```text
research-os/research.ts
```

It should initially support:

```bash
npx tsx research-os/research.ts search "traceability"
```

Expected output:

```text
P001
Anonymous Group Signatures...

P002
Lattice-Based Anonymous Signatures...

P007
Distributed Opening...
```

Then:

```bash
npx tsx research-os/research.ts search "trusted opener"
```

P007 should appear.

At this point:

```text
USER
 ↓
Research CLI
 ↓
Repository
 ↓
Mock research data
```

That's all.

### CHECKPOINT 3

You now have a functioning research search system.

Still **no LLM required**.

---

# Phase 9 — Connect ResearchOS to H-MEM

Now things get interesting.

Remember that the supplied notebook already loads H-MEM through:

```typescript
import { loadHMEM } from "./src/engine.ts";
```

and instantiates it with a persistent directory. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/templates/agentathon-starter/notebook.ts)

We reuse that.

Create:

```text
research-os/src/memory/research-memory.ts
```

Its responsibility:

```text
rememberResearchFinding()
retrieveResearchMemory()
```

For example:

```text
rememberResearchFinding({
    type: "CLAIM",
    content: "...",
    source: "P007"
})
```

Don't build contradiction detection yet.

---

# Phase 10 — Seed H-MEM with researcher knowledge

Here's an important distinction.

We **don't** put all papers into H-MEM.

Put the researcher's conclusions into H-MEM.

For example:

```text
Research evidence
P001
P002
P007

         ≠

Research memory
```

Instead:

```text
P001 + P002
     ↓
researcher concludes
     ↓
"Traceability requires trusted opener"
     ↓
H-MEM
```

Therefore load `notes.json` into H-MEM.

Create a command:

```bash
npx tsx research-os/research.ts seed-memory
```

It should read:

```text
notes.json
```

and call H-MEM.

Then:

```bash
npx tsx research-os/research.ts memory "trusted opener"
```

should return:

```text
N002 / corresponding H-MEM memory

Traceable group signatures require
a trusted opening authority.
```

### CHECKPOINT 4

Now we have:

```text
             ResearchOS
                 │
        ┌────────┴─────────┐
        ▼                  ▼

 Research evidence     Research memory

 JSON datasets           H-MEM
        │                  │
        ▼                  ▼

"What exists?"       "What have I learned?"
```

This is the core architecture.

---

# Phase 11 — Now integrate Zetaris

Only now.

Zetaris's own hackathon getting-started sequence is sensible: get an instance running, run SQL against supplied samples, then connect your own data. [GitHub](https://github.com/zetaris/getting-started/blob/main/START-HERE.md?utm_source=chatgpt.com)

You therefore want:

```text
papers
notes
experiments
```

available through Zetaris.

The architecture changes from:

```text
Research Agent
      │
      ▼
repository.ts
      │
      ▼
JSON
```

to:

```text
Research Agent
      │
      ▼
repository.ts
      │
      ▼
Zetaris
      │
 ┌────┼────┐
 ▼    ▼    ▼
Papers Notes Experiments
```

The **Research Agent shouldn't care** whether the data came from JSON or Zetaris.

That's why we created `repository.ts`.

---

# Phase 12 — Create a Zetaris adapter

Create:

```text
research-os/src/zetaris/client.ts
```

and:

```text
research-os/src/zetaris/repository.ts
```

Conceptually:

```typescript
interface ResearchRepository {

    searchPapers(query: string)

    getNotes(topic: string)

    getExperiments(scheme: string)

}
```

Then have:

```text
LocalResearchRepository
```

and:

```text
ZetarisResearchRepository
```

Both implement the same interface.

Now you can switch:

```text
DATA_SOURCE=local
```

or:

```text
DATA_SOURCE=zetaris
```

This is excellent for a hackathon because **your demo doesn't die if Zetaris/network access temporarily fails**.

---

# Phase 13 — Build one cross-source research query

Don't immediately make the LLM generate SQL.

Hard-code one useful query first.

For example:

> Find post-quantum schemes providing anonymity + traceability, together with experiments and researcher notes.

Conceptually:

```sql
SELECT
    p.title,
    p.method,
    p.trusted_opener_required,
    e.verify_time_ms,
    n.text
FROM papers p
LEFT JOIN experiments e
    ON p.paper_id = e.paper_id
LEFT JOIN notes n
    ...
WHERE
    p.post_quantum = true
AND p.provides_anonymity = true
AND p.provides_traceability = true
```

Don't worry if the actual Zetaris syntax/source configuration requires adjustment; the goal is the data flow.

### CHECKPOINT 5

We want:

```text
                   ZETARIS

            federated evidence

        ┌─────────┼─────────┐

      papers     notes    experiments

                   │
                   ▼

             repository.ts

                   │
                   ▼

              ResearchOS
```

---

# Phase 14 — Build the Research Agent

Now we're finally ready for the agent.

Create:

```text
research-os/src/agents/research-agent.ts
```

Its job:

```text
QUESTION
   ↓
search H-MEM
   ↓
identify what we already know
   ↓
search Zetaris
   ↓
collect evidence
   ↓
produce conclusion
   ↓
store new learning in H-MEM
```

For example:

```text
QUESTION

Can traceability work without
a trusted opener?

        ↓

H-MEM

Current belief:
"No"

        ↓

ZETARIS

P007:
"Yes, using threshold opening"

        ↓

REASON

New evidence contradicts memory

        ↓

ANSWER

Evidence suggests yes.

        ↓

H-MEM

Store updated conclusion
```

That's the first version of your actual agent.

---

# Phase 15 — Add the LLM

Only at this stage would I add a model.

The Meterless starter itself supports an optional model path; without a model it operates retrieval-only. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/templates/agentathon-starter/README.md)

You can choose your provider later.

The LLM receives something like:

```text
QUESTION

Can traceability be achieved without
a trusted opener?


EXISTING RESEARCH MEMORY

M12:
Traceability requires trusted opener.


NEW EVIDENCE

P007:
Distributed threshold opening provides
traceability without one trusted authority.


TASK

Evaluate the evidence.

Determine whether it:
SUPPORTS
CONTRADICTS
EXTENDS
or is UNRELATED

to existing memory.

Produce a research conclusion.
```

Now you're using the LLM for **reasoning**, not storage.

---

# Phase 16 — Add contradiction detection

Create:

```text
research-os/src/agents/evaluator.ts
```

Have it produce structured output:

```json
{
  "relationship": "CONTRADICTS",
  "memory_id": "M12",
  "evidence": ["P007"],
  "confidence": 0.87,
  "reason": "P007 demonstrates distributed threshold opening."
}
```

UI later shows:

```text
⚠ CONTRADICTION DETECTED

Existing belief
────────────────────
Traceability requires a
trusted opening authority.

New evidence
────────────────────
P007 demonstrates distributed
threshold opening.

Recommendation
────────────────────
Revise existing conclusion.
```

This is probably your strongest feature.

---

# Phase 17 — Build the iterative agent

Now move beyond:

```text
question → search → answer
```

into:

```text
question
   ↓
PLAN
   ↓
search memory
   ↓
search evidence
   ↓
EVALUATE
   ↓
enough evidence?
   │
 ┌─┴─┐
 NO YES
 │   │
 ▼   ▼
search answer
again
```

Limit it to perhaps:

```text
MAX_ITERATIONS = 3
```

for the hackathon.

You don't want a runaway research agent.

---

# Phase 18 — NOW add Markovian

This is the last backend feature I'd add.

The current Meterless repository already contains exactly the example we want:

```text
examples/memory-compounding-research/
```

It combines **real H-MEM + real Markovian with a mock LLM**. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/examples/memory-compounding-research/index.ts)

Before modifying ResearchOS, go back to the repository root.

From your current directory:

```bash
cd ../..
```

Check:

```bash
pwd
```

You should be at the Meterless root.

Run:

```bash
npx tsx examples/memory-compounding-research/index.ts
```

Study the output.

That example demonstrates:

```text
Cold research
      VS
Warm research
      │
      ▼
H-MEM supplies previous knowledge
      │
      ▼
Markovian avoids repeating
settled research steps
```

The current example literally feeds H-MEM's retrieved context into:

```typescript
markovian.run({
    goal,
    memoryContext,
    generator
})
```

and compares the cold and memory-aware runs. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/examples/memory-compounding-research/index.ts)

That's almost exactly what we want.

---

# Phase 19 — Adapt Markovian to ResearchOS

Our state might be:

```text
GOAL

Determine whether post-quantum
anonymous attestation can provide
distributed traceability.
```

Markovian maintains:

```text
COMPLETED

Found lattice anonymous schemes.
Confirmed traceability.
Found distributed opening evidence.


REMAINING

Compare threshold schemes.
Check performance results.


DECISIONS

Single trusted opener not mandatory.


CONTEXT

Investigating privacy-preserving
swarm attestation.
```

Instead of sending the entire research history back into every LLM call, Markovian carries the useful research state forward.

Meterless's implementation is specifically designed around this state/chunk/carryover mechanism. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/engines/markovian/reference/src/index.ts)

---

# Phase 20 — Only then build the UI

Once everything above works:

```text
Research question
        ↓
H-MEM
        ↓
Zetaris
        ↓
Agent
        ↓
Evaluator
        ↓
Markovian
        ↓
Answer
```

THEN build the nice interface.

Don't start with React.

For the hackathon demo, I'd eventually aim for:

```text
┌────────────────────────────────────────────┐
│ ResearchOS                                 │
├────────────────────────┬───────────────────┤
│                        │ RESEARCH MEMORY   │
│ Question               │                   │
│                        │ ✓ CLAIM           │
│ Can traceability work  │ anonymity         │
│ without trusted        │                   │
│ opening?               │ ⚠ CONTRADICTION   │
│                        │ trusted opener    │
│                        │                   │
├────────────────────────┼───────────────────┤
│ EVIDENCE               │ AGENT TRACE       │
│                        │                   │
│ P007  ████████         │ ✓ Search memory  │
│ P009  ███████          │ ✓ Query Zetaris  │
│ E002  █████            │ ✓ Found conflict │
│                        │ ✓ Investigate     │
│                        │ ✓ Conclusion      │
└────────────────────────┴───────────────────┘
```

---

# Your build order

So the complete implementation sequence is:

1. **Get original H-MEM starter running**
2. **Test persistence**
3. **Create mock papers**
4. **Create mock notes**
5. **Create mock experiments**
6. **Build local repository**
7. **Build `research search` CLI**
8. **Connect research notes → H-MEM**
9. **Test research-memory persistence**
10. **Set up Zetaris**
11. **Put/expose datasets through Zetaris**
12. **Create Zetaris repository adapter**
13. **Run one cross-source query**
14. **Build Research Agent**
15. **Add LLM reasoning**
16. **Add contradiction evaluator**
17. **Create iterative research loop**
18. **Add Markovian**
19. **Test cold vs warm research**
20. **Build UI**
21. **Polish the two-minute demo**

This ordering also plays directly to Meterless's judging criteria: **25% is specifically Meterless engine usage**, while usefulness is 30%, local-first/privacy 15%, and demo quality 15%. [GitHub](https://raw.githubusercontent.com/Meterless/Meterless/main/docs/community/hackathon-guide.md)

### What I want you to do now

Don't jump to Zetaris yet.

Run these **four commands from your current `agentathon-starter` directory**:

```bash
npm install
npm run setup
npx tsx notebook.ts seed
npx tsx notebook.ts ask "what did we decide about storage"
```

If those work, send me the output of the **last command**.

Then I'll take you through **Phase 2–8 hands-on**, including giving you the complete mock `papers.json`, `notes.json`, `experiments.json`, the first Cursor prompt, and the exact tests to run. This way we build it incrementally and know exactly which layer is working before adding Zetaris.