## Refactored Autonomous Agentic Feedback Architecture

To transform the pipeline from a feed-forward pipeline into a genuine agentic loop, **SameStory** introduces a closed **ReAct / Reflection Feedback Loop**.

Instead of moving evidence strictly from left to right, the **Investigation Lead Agent** dynamically plans queries, delegates tasks to specialized sub-agents, inspects intermediate findings for gaps or contradictions, and triggers targeted follow-up investigations until evidence reaches verifiable confidence.

```
                     ┌──────────────────────────────────────────────────┐
                     │          Editor Input (Claim + Media)            │
                     └─────────────────────────┬────────────────────────┘
                                               │
                                               ▼
                     ┌──────────────────────────────────────────────────┐
                     │      Investigation Lead Agent (Orchestrator)     │◄───────────────────┐
                     │   - Maintains Blackboard State & Hypotheses      │                    │
                     │   - Evaluates Convergence & Stopping Criteria    │                    │
                     └────┬────────────────────▲────────────────────┬───┘                    │
                          │                    │                    │                        │
       1. Dispatches Tasks│   2. Streams State │ 4. Queries Delta   │ 5. Triggers Follow-Up  │
                          ▼                    │    vs Memory       │    Clarifications      │
     ┌────────────────────────────────────┐    │                    │                        │
     │      Active Sub-Agent Swarm        │    │                    │                        │
     │  ┌──────────────────────────────┐  │    │                    │                        │
     │  │   Retrieval Agent (Zetaris)  │──┼────┤                    │                        │
     │  └──────────────────────────────┘  │    │                    │                        │
     │  ┌──────────────────────────────┐  │    │                    │                        │
     │  │   Vision / Provenance Agent  │──┼────┤                    │                        │
     │  └──────────────────────────────┘  │    │                    │                        │
     │  ┌──────────────────────────────┐  │    │                    │                        │
     │  │   Lineage & Copy-DeDup Agent │──┼────┤                    │                        │
     │  └──────────────────────────────┘  │    │                    │                        │
     │  ┌──────────────────────────────┐  │    │                    │                        │
     │  │   Narrative Clustering Agent │──┼────┘                    │                        │
     │  └──────────────────────────────┘  │                         │                        │
     └─────────────────┬──────────────────┘                         │                        │
                       │ Clusters & Independent Lineages            │                        │
                       ▼                                            │                        │
     ┌──────────────────────────────────────────────────┐           │                        │
     │      Contradiction & Evidence Critic Agent       │           │                        │
     │   - Cross-examines 5W1H entity alignment         │           │                        │
     │   - Checks image-to-text event conflicts         │           │                        │
     │   - Computes Evidence Sufficiency Metric         │           │                        │
     └─────────────────┬────────────────────────────────┘           │                        │
                       │                                            │                        │
         [Is Evidence Contradictory, Thin, or Ambiguous?]           │                        │
                       │                                            │                        │
              Yes ─────┴────────────────────────────────────────────┘                        │
         (Generate Targeted Query: e.g. "Resolve crash date")                                │
                       │                                                                     │
              No (Criteria Met: Supported, Refuted, or Max Iterations Reached)               │
                       │                                                                     │
                       ▼                                                                     │
     ┌──────────────────────────────────────────────────┐                                    │
     │          Memory & Revision Agent (H-MEM)         │                                    │
     │   - Recalls prior verdicts & checks contradictions────────────────────────────────────┘
     │   - Computes state deltas (UNCHANGED vs REVISE)  │
     └─────────────────┬────────────────────────────────┘
                       │
                       ▼
     ┌──────────────────────────────────────────────────┐
     │       Synthesis & Guardrail Verdict Desk         │
     │   - Enforces deterministic verdict mapping       │
     │   - NVIDIA Nemotron explanation generation       │
     │   - Prunes ungrounded citation tokens            │
     └─────────────────┬────────────────────────────────┘
                       │
                       ▼
     ┌──────────────────────────────────────────────────┐
     │        Final Multimodal Dossier & Action         │
     └──────────────────────────────────────────────────┘

```

---

## The Dynamic Inter-Agent Communication Loop

### 1. The Blackboard State

The agents share a mutable workspace (the **Investigation State**) rather than passing isolated function arguments:

* `claim_asserted`: `{ text, claimed_event, image_url }`


* `hypotheses`: Competing event hypotheses ($E_1, E_2, \dots$)


* `evidence_graph`: Deduplicated source lineage nodes and edges


* `unresolved_gaps`: Missing 5W1H elements (e.g., missing original capture date, unverified wreckage registration number)


* `iteration_count`: Bounded loop counter (Max: 3 iterations)



---

### 2. Dialogue & Decision Cycle

#### Phase A: Task Dispatch & Hypotheses Generation

* The **Investigation Lead Agent** reads the claim and dispatches parallel sub-tasks:


* Calls **Retrieval Agent** to query Zetaris text databases.


* Calls **Vision / Provenance Agent** to match visual features against indexed archives.




* The **Lineage & Copy-DeDup Agent** inspects incoming rows, detects syndication trees (`origin_id`), and replaces repost floods with collapsed independent nodes.


* The **Narrative Clustering Agent** partitions evidence into candidate event clusters based on 5W1H overlap.



#### Phase B: The Adversarial Critic Evaluation (Feedback Trigger)

* The **Contradiction & Evidence Critic Agent** analyzes the active clusters against the claim:


* *Discrepancy Check*: Does the earliest image archive event match the caption's asserted event?


* *Independence Ratio Check*: Are all supporting sources coming from a single copy-paste lineage?


* *Information Gap Check*: Are critical 5W1H anchors (dates, exact location, plane model) missing or conflicting?




* **Feedback Branch**:
* **If Gaps or Contradictions Exist**: The Critic does **not** finalize a verdict. It formulates a concrete sub-query (e.g., `QUERY: "MiG-27 crash Jodhpur official statement date"`) and routes it back to the **Investigation Lead**.


* The Lead instructs the **Retrieval Agent** to pull targeted records to resolve that specific contradiction.


* The pipeline loops until confidence is reached or the step budget is exhausted.





#### Phase C: Memory Reconciliation Loop

* Once stabilized, the **Memory & Revision Agent (H-MEM)** checks historical investigations for identical or overlapping claim signatures.


* If a prior verdict exists (e.g., an earlier breaking report marked `INSUFFICIENT`), the agent computes a difference log, tagging whether new evidence warrants an `UNCHANGED` verdict or a `REVISE` alert.



#### Phase D: Deterministic Verdict & Grounded Explanation

* The final evidence graph is passed to the **Deterministic Engine**, ensuring the verdict (`MISLEADING_CONTEXT`, `SUPPORTED`, `DISPUTED`, or `INSUFFICIENT`) is anchored directly in lineage counts and visual provenance.


* **NVIDIA Nemotron** drafts the final editorial synthesis, citing *only* validated lineage IDs from the blackboard.



---

## Concrete Loop Trace: The CRAVE Aircraft Case

| Turn / Step | Acting Agent | Action & Inter-Agent Dialogue | State / Evidence Graph Delta |
| --- | --- | --- | --- |
| **Turn 1.0** | **Lead Orchestrator** | Dispatches claim text + image URL to Retrieval & Vision agents.

 | Loop initialized ($i=0$).

 |
| **Turn 1.1** | **Retrieval & Vision Agents** | • Vision finds identical airframe image indexed in 2016.

<br>

<br>• Retrieval finds 8 wire stories claiming a 2019 shootdown.

 | 9 raw evidence rows retrieved.

 |
| **Turn 1.2** | **Lineage Agent** | Collapses the 8 shootdown articles: all 8 trace back to a single unverified blog post (`origin_id: blog_x`, copies: 7).

 | Independent nodes: 2 (1 wire archive, 1 blog repost tree).

 |
| **Turn 1.3** | **Evidence Critic (Criticism)** | *Critique*: "Temporal contradiction detected. Image provenance points to Jodhpur 2016 training sortie, but 2019 blog claims a Kashmir combat shootdown. Missing definitive airframe tail-number verification to confirm if 2016 image is the exact same airframe."

 | Gap logged: `need_tail_number_verification`.

 |
| **Turn 2.0 (Loop)** | **Lead $\rightarrow$ Retrieval** | Issues targeted query: `"MiG-27 Jodhpur 2016 crash IAF press release airframe"`.

 | Loop incremented ($i=1$).

 |
| **Turn 2.1** | **Retrieval Agent** | Pulls official press release confirming the exact wreckage photo is from the 2016 routine training flight.

 | Primary archive lineage updated to high confidence.

 |
| **Turn 2.2** | **Evidence Critic** | *Critique*: "Contradiction resolved. Asserted 2019 event is contradicted by authenticated 2016 image provenance. Repetition on 2019 claim is copy-only."

 | Stopping criteria met. Emits convergence flag.

 |
| **Turn 3.0** | **Memory (H-MEM)** | Compares state with prior run: Prior run held as `INSUFFICIENT` due to missing origin. New run resolves context. Emits `REVISE`.

 | State delta attached.

 |
| **Turn 3.1** | **Verdict & Synthesis** | Deterministic engine sets `MISLEADING_CONTEXT` (Action: **DO NOT PUBLISH**). Nemotron writes summary using lineage nodes.

 | Investigation Dossier ready.

 |

---

## Why This Architecture Wins Track 2

1. **True Autonomous Agency**: Demonstrates self-directed inquiry—the agent detects what it does *not* know, forms targeted follow-up queries, and reconciles contradictions without human intervention.


2. **Transparent Inter-Agent Dialogue**: Judges can view the step-by-step trace of agents questioning each other in the UI (Critic challenging Retrieval; Lineage challenging raw counts).


3. **Robustness Over Hallucination**: The closed loop combines autonomous multi-hop reasoning with a deterministic guardrail verdict engine and citation pruner, ensuring that higher agent autonomy does not produce hallucinated conclusions.
