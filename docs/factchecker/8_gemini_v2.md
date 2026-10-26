The updated architecture integrates **Meterless** as the async workflow orchestrator, **Nightshift** as the managed runtime gateway to execute **NVIDIA Nemotron** inference, and **Zetaris** as the unified federated data fabric.

---

### 1. Updated System Architecture Diagram

```text
                     ┌─────────────────────────────────────────────────────────┐
                     │            User / Newsroom Editor Terminal              │
                     └────────────────────────────┬────────────────────────────┘
                                                  │ Claim Text + Media URL
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           METERLESS ORCHESTRATION ENGINE (Workflow DAG)                               │
│  - Schedules asynchronous task steps, handles retries, and records step execution telemetry           │
│  - Houses the Shared Blackboard State (Accumulated Evidence, Lineages, Precedents, Iteration Turns)   │
└──────────────┬──────────────────────────────────┬─────────────────────────────────────┬───────────────┘
               │                                  │                                     │
               │ Direct SQL / JDBC                │ RPC / HTTP Gateway                  │ Memory Hook
               ▼                                  ▼                                     ▼
 ┌───────────────────────────┐      ┌───────────────────────────┐         ┌───────────────────────────┐
 │    ZETARIS DATA FABRIC    │      │    NIGHTSHIFT RUNTIME     │         │      H-MEM STATE HUB      │
 │  (Federated Data Network) │      │ (Managed Nemotron Engine) │         │ (Episodic & Entity Memory)│
 ├───────────────────────────┤      ├───────────────────────────┤         ├───────────────────────────┤
 │ • Wire Archive Tables     │      │ • NVIDIA Nemotron 70B     │         │ • Past Claim Verdicts     │
 │ • Media Provenance Store  │      │ • Evidence Critic Prompt  │         │ • Editorial Stance State  │
 │ • Web / Repost Repos      │      │ • Semantic Search Prompt  │         │ • Historical Precedents   │
 │ • Param / Ad-hoc Queries  │      │ • Final Dossier Synthesizer│        │ • Temporal Delta Engine   │
 └─────────────┬─────────────┘      └─────────────┬─────────────┘         └─────────────┬─────────────┘
               │                                  │                                     │
               └─────────────────┬────────────────┴─────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               THE METERLESS AGENTIC FEEDBACK LOOP                                     │
│                                                                                                       │
│   Step 1: Ingest Claim & Direct Recall (H-MEM) ────────────────────────────────────────┐              │
│   Step 2: Initial Evidence Fetch (Zetaris Connector)                                   │              │
│   Step 3: Lineage Graph Collapse & Provenance Mapping (Deterministic)                  │              │
│   Step 4: Evidence Critic Evaluation (Nightshift -> Nemotron)                          │              │
│             │                                                                          │              │
│             ├─► [Contradiction / Missing Wire?] ──► Trigger Targeted Search (Zetaris) ─┤ (Iterate)   │
│             │                                   ──► Trigger Precedent Query (H-MEM) ───┤              │
│             │                                                                          │              │
│             └─► [Converged or Max Turns Reached?]                                      │              │
│                       │                                                                │              │
│   Step 5: Apply Deterministic Guardrail Verdict Matrix (Rule Engine)                   │              │
│   Step 6: Compute Revision Delta vs Past Check (H-MEM) ◄───────────────────────────────┘              │
│   Step 7: Structured Dossier Synthesis & Citation Filter (Nightshift -> Nemotron)                     │
└────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
                             ┌───────────────────────────────────────┐
                             │ Final Editorial Dossier & Action Badge│
                             └───────────────────────────────────────┘

```

---

### 2. Integration Responsibilities & Boundaries

| Component | Integration Method | Role in SameStory |
| --- | --- | --- |
| **Meterless** | Python Workflow Decorator / Context Manager | Manages the loop lifecycle, task retries, state machine transitions, and timing metrics.

 |
| **Zetaris** | Virtual SQL / JDBC Connection Client | Connects federated data nodes (social feeds, media archives, and wire catalogs) under one query endpoint without raw web-crawling overhead.

 |
| **Nightshift** | HTTP / Client Runner API | Manages token streaming, authentication, and execution of **NVIDIA Nemotron** inference calls for reasoning tasks.

 |
| **H-MEM** | Local / Persistent Memory Store | Manages historical claim indexing and revision diffing (`UNCHANGED` vs `REVISE`).

 |

---

### 3. Concrete Code Implementation

This runnable implementation demonstrates **Meterless** orchestrating the workflow, **Nightshift** invoking **Nemotron**, and **Zetaris** executing federated queries.

```python
"""
SameStory: Autonomous Evidence Lineage & Context Verification Desk
Integrated with:
- Meterless (Workflow orchestration & loop management)
- Nightshift (Execution runtime for NVIDIA Nemotron)
- Zetaris (Federated data fabric querying)
- H-MEM (Episodic and revision memory)
"""

import os
import json
import time
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

# ============================================================================
# 1. INTEGRATION ADAPTERS (ZETARIS, NIGHTSHIFT, H-MEM)
# ============================================================================

class ZetarisClient:
    """
    Adapter simulating the Zetaris Federated Data Fabric interface.
    Allows executing analytical SQL queries over disparate data sources.
    """
    def __init__(self, endpoint_url: str = "mock://zetaris.internal:9000"):
        self.endpoint_url = endpoint_url
        self._seed_virtual_tables()

    def _seed_virtual_tables(self):
        self.evidence_table = [
            {
                "id": "row-mig-01",
                "claim_id": "claim-mig27-viral",
                "text": "Viral tweet: Indian Air Force fighter jet shot down in dogfight over Kashmir.",
                "published_at": "2019-02-27T09:00:00Z",
                "event_id": "conflict-2019-kashmir",
                "origin_id": "origin-viral-tweet-101",
                "kind": "repost",
                "url": "https://social.mock/post/101",
                "image_match": True,
                "source_domain": "social.mock",
                "is_targeted_followup": False
            },
            {
                "id": "row-mig-02",
                "claim_id": "claim-mig27-viral",
                "text": "Breaking forum post: Confirmed shootdown of IAF aircraft, wreckage photos shared.",
                "published_at": "2019-02-27T09:15:00Z",
                "event_id": "conflict-2019-kashmir",
                "origin_id": "origin-viral-tweet-101",
                "kind": "repost",
                "url": "https://blog.mock/breaking/202",
                "image_match": True,
                "source_domain": "blog.mock",
                "is_targeted_followup": False
            },
            {
                "id": "row-mig-03",
                "claim_id": "claim-mig27-viral",
                "text": "Defense blog repeats: Downed plane photo circulating online.",
                "published_at": "2019-02-27T09:30:00Z",
                "event_id": "conflict-2019-kashmir",
                "origin_id": "origin-viral-tweet-101",
                "kind": "repost",
                "url": "https://warblog.mock/post/303",
                "image_match": True,
                "source_domain": "warblog.mock",
                "is_targeted_followup": False
            },
            {
                "id": "row-mig-04",
                "claim_id": "claim-mig27-viral",
                "text": "Archived image match: MiG-27 aircraft crashed during routine training sortie in Jodhpur residential vicinity.",
                "published_at": "2016-06-13T06:10:00Z",
                "event_id": "jodhpur-2016-crash",
                "origin_id": "origin-reuters-2016",
                "kind": "wire",
                "url": "https://reuters.mock/archive/2016/jodhpur",
                "image_match": True,
                "source_domain": "reuters.mock",
                "is_targeted_followup": False
            },
            {
                "id": "row-mig-followup-01",
                "claim_id": "claim-mig27-viral",
                "text": "IAF Official Press Release: Court of inquiry ordered into Jodhpur MiG-27 crash on June 13, 2016. No casualties.",
                "published_at": "2016-06-13T12:00:00Z",
                "event_id": "jodhpur-2016-crash",
                "origin_id": "origin-iaf-archive-2016",
                "kind": "archive",
                "url": "https://mod.gov.mock/press/2016/mig27",
                "image_match": True,
                "source_domain": "mod.gov.mock",
                "is_targeted_followup": True
            }
        ]

    def query(self, sql_stmt: str, params: Dict[str, Any]) -> List[Dict]:
        """Simulates SQL execution across Zetaris virtual enterprise tables."""
        claim_id = params.get("claim_id")
        is_followup = params.get("is_followup", False)
        search_terms = params.get("search_terms", [])

        results = []
        for r in self.evidence_table:
            if r["claim_id"] != claim_id:
                continue
            if not is_followup and not r["is_targeted_followup"]:
                results.append(r)
            elif is_followup and r["is_targeted_followup"]:
                corpus = (r["text"] + " " + r["event_id"]).lower()
                if any(t.lower() in corpus for t in search_terms):
                    results.append(r)
        return results


class NightshiftNemotronClient:
    """
    Adapter for Nightshift runner executing NVIDIA Nemotron reasoning models.
    """
    def __init__(self, api_key: str = "mock-nightshift-token", model_name: str = "nvidia/nemotron-4-340b-instruct"):
        self.api_key = api_key
        self.model_name = model_name

    def call_nemotron(self, task_type: str, system_prompt: str, user_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Simulates remote inference call through Nightshift."""
        # Task 1: Adversarial Critic
        if task_type == "CRITIC_INSPECTION":
            photo_event = user_payload.get("photo_provenance_event")
            claimed_event = user_payload.get("claimed_event")
            retrieved_rows = user_payload.get("retrieved_rows", [])

            has_official = any(r.get("kind") == "archive" and r.get("event_id") == photo_event for r in retrieved_rows)

            if photo_event and photo_event != claimed_event and not has_official:
                return {
                    "converged": False,
                    "reasoning": f"Temporal mismatch: photo provenance points to '{photo_event}', but claim asserts '{claimed_event}'.",
                    "zetaris_query_terms": [photo_event, "official", "press", "inquiry"],
                    "hmem_search_terms": [photo_event, "recycled", "crash"]
                }
            return {
                "converged": True,
                "reasoning": "Evidence graph consistent. Lineages and media provenance validated.",
                "zetaris_query_terms": [],
                "hmem_search_terms": []
            }

        # Task 2: Dossier Synthesis
        elif task_type == "DOSSIER_SYNTHESIS":
            verdict = user_payload.get("verdict")
            action = user_payload.get("action")
            lineages = user_payload.get("lineages", [])
            photo_event = user_payload.get("photo_provenance_event")
            claimed_event = user_payload.get("claimed_event")

            text = (
                f"Editorial Verdict: {verdict}. Directive: {action}\n"
                f"- Evaluated {len(lineages)} collapsed evidence lineages.\n"
                f"- Media Authenticity: Primary wire match establishes photo context as [{photo_event}], "
                f"debunking claimed context [{claimed_event}]. All posts citing combat shootdown are syndicated reposts."
            )
            return {"synthesis_text": text}

        return {"error": "Unsupported task_type"}


class MeterlessWorkflowManager:
    """
    Lightweight orchestration context mirroring the Meterless workflow pattern.
    Tracks DAG steps, handles execution barriers, and logs telemetry.
    """
    def __init__(self, workflow_name: str):
        self.workflow_name = workflow_name
        self.execution_log = []

    def step(self, step_name: str, agent_name: str, llm_engaged: bool):
        class StepContext:
            def __init__(self, mgr, s_name, a_name, llm):
                self.mgr = mgr
                self.s_name = s_name
                self.a_name = a_name
                self.llm = llm
                self.start_t = 0

            def __enter__(self):
                self.start_t = time.time()
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                duration_ms = round((time.time() - self.start_t) * 1000, 2)
                self.mgr.execution_log.append({
                    "step": self.s_name,
                    "agent": self.a_name,
                    "llm_engaged": self.llm,
                    "duration_ms": duration_ms,
                    "status": "SUCCESS" if exc_type is None else "FAILED"
                })
        return StepContext(self, step_name, agent_name, llm_engaged)

# ============================================================================
# 2. STATE MODELS
# ============================================================================

class EvidenceRow(BaseModel):
    id: str
    claim_id: str
    text: str
    published_at: str
    event_id: str
    origin_id: str
    kind: str
    url: str
    image_match: bool
    source_domain: str
    is_targeted_followup: bool = False

class LineageGroup(BaseModel):
    origin_id: str
    event_id: str
    root_source: str
    kind: str
    repost_count: int
    row_ids: List[str]
    is_independent: bool
    summary: str

class MemoryRecord(BaseModel):
    claim_id: str
    timestamp: str
    verdict: str
    action: str
    reasoning: str

class InvestigationState(BaseModel):
    claim_id: str
    caption: str
    claimed_event: str
    image_id: Optional[str] = None
    retrieved_rows: List[EvidenceRow] = []
    lineages: List[LineageGroup] = []
    photo_provenance_event: Optional[str] = None
    critic_notes: List[str] = []
    current_turn: int = 0
    max_turns: int = 3
    is_converged: bool = False
    prior_record: Optional[MemoryRecord] = None
    memory_status: str = "NEW"
    memory_diff_summary: Optional[str] = None
    verdict: Optional[str] = None
    editorial_action: Optional[str] = None
    final_explanation: Optional[str] = None

# ============================================================================
# 3. CORE INVESTIGATION WORKFLOW
# ============================================================================

class SameStoryInvestigationDesk:
    def __init__(self):
        self.orchestrator = MeterlessWorkflowManager("SameStory-Desk-Pipeline")
        self.zetaris = ZetarisClient()
        self.nightshift = NightshiftNemotronClient()
        self.hmem_store: Dict[str, Dict] = {
            "claim-mig27-viral": {
                "claim_id": "claim-mig27-viral",
                "timestamp": "2026-10-25T14:30:00Z",
                "verdict": "INSUFFICIENT",
                "action": "HOLD: Only unverified social posts available.",
                "reasoning": "Holding post pending verification."
            }
        }

    def _collapse_lineages(self, rows: List[EvidenceRow]) -> List[LineageGroup]:
        groups: Dict[str, List[EvidenceRow]] = {}
        for r in rows:
            groups.setdefault(r.origin_id, []).append(r)

        lineages = []
        for origin_id, g_rows in groups.items():
            primary = next((r for r in g_rows if r.kind in ["archive", "wire"]), None)
            is_independent = primary is not None
            root = primary if primary else g_rows[0]
            reposts = [r for r in g_rows if r.kind == "repost"]

            lineages.append(LineageGroup(
                origin_id=origin_id,
                event_id=root.event_id,
                root_source=root.source_domain,
                kind=root.kind,
                repost_count=len(reposts),
                row_ids=[r.id for r in g_rows],
                is_independent=is_independent,
                summary=root.text
            ))
        return lineages

    def _resolve_photo_event(self, rows: List[EvidenceRow]) -> Optional[str]:
        archives = [r for r in rows if r.image_match and r.kind in ["archive", "wire"]]
        if archives:
            earliest = min(archives, key=lambda x: x.published_at)
            return earliest.event_id
        return None

    def _evaluate_verdict_rules(self, state: InvestigationState) -> tuple[str, str]:
        if not state.lineages:
            return "INSUFFICIENT", "HOLD: Zero verified evidence records found."

        independent = [l for l in state.lineages if l.is_independent]
        if not independent:
            return "INSUFFICIENT", "HOLD: Only syndicated reposts available."

        if state.photo_provenance_event and state.photo_provenance_event != state.claimed_event:
            photo_lineages = [l for l in independent if l.event_id == state.photo_provenance_event]
            if photo_lineages:
                return "MISLEADING_CONTEXT", f"DO NOT PUBLISH: Media originated in '{state.photo_provenance_event}'."

        events = {l.event_id for l in independent}
        if len(events) > 1:
            return "DISPUTED", f"HOLD: Conflicting independent wire accounts: {list(events)}."

        if all(l.event_id == state.claimed_event for l in independent):
            return "SUPPORTED", f"PUBLISH: Verified by {len(independent)} independent archival/wire lineage(s)."

        return "INSUFFICIENT", "HOLD: Inconclusive evidence."

    def run(self, claim_id: str, caption: str, claimed_event: str, image_id: str = None) -> InvestigationState:
        state = InvestigationState(
            claim_id=claim_id,
            caption=caption,
            claimed_event=claimed_event,
            image_id=image_id
        )

        # Step 1: H-MEM Memory Recall (Direct Lookup)
        with self.orchestrator.step("HMemRecall", "MemoryAgent", llm_engaged=False):
            if claim_id in self.hmem_store:
                state.prior_record = MemoryRecord(**self.hmem_store[claim_id])

        # Step 2: Zetaris Initial Ingestion
        with self.orchestrator.step("ZetarisInitialQuery", "RetrievalAgent", llm_engaged=False):
            raw_data = self.zetaris.query(
                "SELECT * FROM virtual_news_wire WHERE claim_id = :claim_id",
                {"claim_id": claim_id, "is_followup": False}
            )
            state.retrieved_rows.extend([EvidenceRow(**r) for r in raw_data])

        # Step 3: Meterless Agentic Feedback Loop
        while state.current_turn < state.max_turns and not state.is_converged:
            state.current_turn += 1

            # Lineage & Vision Resolution (Deterministic)
            with self.orchestrator.step(f"LineageResolution_T{state.current_turn}", "LineageAgent", llm_engaged=False):
                state.photo_provenance_event = self._resolve_photo_event(state.retrieved_rows)
                state.lineages = self._collapse_lineages(state.retrieved_rows)

            # Adversarial Critic via Nightshift (Nemotron Call)
            with self.orchestrator.step(f"NightshiftCritic_T{state.current_turn}", "CriticAgent", llm_engaged=True):
                critique = self.nightshift.call_nemotron(
                    task_type="CRITIC_INSPECTION",
                    system_prompt="You are an adversarial editorial critic verifying media-text alignment.",
                    user_payload={
                        "photo_provenance_event": state.photo_provenance_event,
                        "claimed_event": state.claimed_event,
                        "retrieved_rows": [r.dict() for r in state.retrieved_rows]
                    }
                )
                state.critic_notes.append(critique["reasoning"])

            if critique.get("converged"):
                state.is_converged = True
                break

            # Follow-up: Zetaris Targeted Search
            if critique.get("zetaris_query_terms"):
                with self.orchestrator.step(f"ZetarisTargetedQuery_T{state.current_turn}", "RetrievalAgent", llm_engaged=False):
                    followup_data = self.zetaris.query(
                        "SELECT * FROM virtual_news_wire WHERE claim_id = :claim_id AND contains(text, :terms)",
                        {
                            "claim_id": claim_id,
                            "is_followup": True,
                            "search_terms": critique["zetaris_query_terms"]
                        }
                    )
                    state.retrieved_rows.extend([EvidenceRow(**r) for r in followup_data])

        # Step 4: Deterministic Guardrail Evaluation
        with self.orchestrator.step("VerdictEvaluation", "GuardrailEngine", llm_engaged=False):
            state.verdict, state.editorial_action = self._evaluate_verdict_rules(state)

        # Step 5: H-MEM Memory Reconcile & Diff
        with self.orchestrator.step("HMemReconciliation", "MemoryAgent", llm_engaged=False):
            if state.prior_record:
                if state.prior_record.verdict == state.verdict:
                    state.memory_status = "UNCHANGED"
                    state.memory_diff_summary = f"Stance reaffirmed: '{state.verdict}'."
                else:
                    state.memory_status = "REVISE"
                    state.memory_diff_summary = (
                        f"REVISE PRIOR DECISION: Stance shifted from '{state.prior_record.verdict}' "
                        f"({state.prior_record.action}) to '{state.verdict}' ({state.editorial_action})."
                    )

        # Step 6: Nightshift Structured Dossier Synthesis (Nemotron Call)
        with self.orchestrator.step("NightshiftDossierSynthesis", "SynthesisAgent", llm_engaged=True):
            synthesis = self.nightshift.call_nemotron(
                task_type="DOSSIER_SYNTHESIS",
                system_prompt="Synthesize a source-grounded editorial investigation report.",
                user_payload={
                    "verdict": state.verdict,
                    "action": state.editorial_action,
                    "lineages": [l.dict() for l in state.lineages],
                    "photo_provenance_event": state.photo_provenance_event,
                    "claimed_event": state.claimed_event
                }
            )
            state.final_explanation = synthesis["synthesis_text"]

        return state

# ============================================================================
# 4. EXECUTION DEMO
# ============================================================================

if __name__ == "__main__":
    desk = SameStoryInvestigationDesk()

    print("================================================================================")
    print("SameStory Investigation Desk (Meterless + Zetaris + Nightshift/Nemotron + H-MEM)")
    print("================================================================================")

    result = desk.run(
        claim_id="claim-mig27-viral",
        caption="IAF fighter jet shot down by Pakistan forces in Kashmir confrontation.",
        claimed_event="conflict-2019-kashmir",
        image_id="img_mig27_wreckage"
    )

    print("\n[METERLESS WORKFLOW STEP TELEMETRY]")
    print("-" * 80)
    for entry in desk.orchestrator.execution_log:
        mode_badge = "[LLM: Nightshift/Nemotron]" if entry["llm_engaged"] else "[RULE: Deterministic]"
        print(f"{entry['step']:<30} | {mode_badge:<27} | Agent: {entry['agent']:<18} ({entry['duration_ms']} ms)")
    print("-" * 80)

    print("\n[INVESTIGATION DOSSIER]")
    print(f"VERDICT         : {result.verdict}")
    print(f"EDITORIAL ACTION: {result.editorial_action}")
    print(f"H-MEM STATUS    : {result.memory_status}")
    print(f"DIFF EXPLANATION: {result.memory_diff_summary}")
    print("\n[GROUNDED SYNTHESIS]")
    print(result.final_explanation)
    print("================================================================================")

```

---

### 4. What Happens in the Execution Flow

1. **Step 1 (`HMemRecall`)**: Meterless queries H-MEM and finds an existing `INSUFFICIENT (HOLD)` desk note from an earlier unverified report.


2. **Step 2 (`ZetarisInitialQuery`)**: Meterless invokes the Zetaris connector, pulling 3 viral reposts and 1 archived wire match for the photograph.


3. **Step 3 (Loop Turn 1)**:
* The **Vision/Provenance Agent** resolves the image's timestamp and determines it belongs to `jodhpur-2016-crash`.


* The **Lineage Agent** collapses the 3 viral reposts under a single origin ID.


* The **Critic Agent** sends the blackboard state to **Nightshift (Nemotron)**. Nemotron detects the temporal mismatch between the 2016 photo and the 2019 claim and requests official archive verification.


* Meterless executes the targeted query back to **Zetaris**, pulling the official press release.




4. **Step 4 (Loop Turn 2)**: The critic confirms the evidence graph has converged.


5. **Step 5 (`VerdictEvaluation`)**: The deterministic rules trigger `MISLEADING_CONTEXT` and set the action to **DO NOT PUBLISH**.


6. **Step 6 (`HMemReconciliation`)**: H-MEM notes the change from `INSUFFICIENT` to `MISLEADING_CONTEXT`, emitting a `REVISE` status.


7. **Step 7 (`NightshiftDossierSynthesis`)**: Nightshift invokes Nemotron to draft the final cited summary using the lineage IDs.
