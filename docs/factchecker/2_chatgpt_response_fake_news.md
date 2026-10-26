# Hackathon Idea Review: From AI Fact-Checker to an Evidence Investigation Agent

My recommendation is to keep the core research idea from CRAVE, but change the product from a generic fake-news detector into a specialised, evidence-driven investigation agent that explains why a claim is misleading, what actually happened, and what evidence would change its conclusion.

This is a stronger direction for Track 2 because it gives the judges a specific user, a meaningful decision, a visible reasoning process, and a demonstrable outcome.

I reviewed both your uploaded research paper, Fact-Checking with Contextual Narratives: Leveraging Retrieval-Augmented LLMs for Social Media Analysis, and Cursor/Grok's `fake_news_idea.md`.

## 1. My assessment of Cursor/Grok's proposal

Overall assessment

Good technical plan, weak product differentiation

Cursor correctly identifies a feasible implementation using your existing ResearchOS, Zetaris, Meterless, Nemotron, and H-MEM components. However, it focuses heavily on what you can build quickly rather than on why somebody would need this particular system.

| Dimension                          | My assessment                          |
| ---------------------------------- | -------------------------------------- |
| Track 2 alignment                  | Strong                                 |
| Technical feasibility              | Strong if scoped                       |
| Social impact                      | Potentially high, but not demonstrated |
| Innovation                         | Moderate                               |
| Demo potential                     | Good                                   |
| Commercial or practical usefulness | Needs a clearer target user            |

### What Cursor got right

Cursor's proposal recommends retaining the existing agent infrastructure, clustering evidence, generating cluster-specific judgments, and producing a final cited verdict. It also recommends avoiding a full live reverse-image-search integration under tight deadlines.

Those are sensible engineering decisions.

### What I would change

- Do not make memory the centre of the product. H-MEM is valuable when new evidence changes a previous conclusion, but users care more about whether the investigation is correct and actionable.
- Do not cluster by source or stance alone. Multiple articles can repeat the same false claim. Cluster by distinct factual narratives or event contexts, and track source independence separately.
- Do not treat LLM agreement as proof. Five models agreeing on the same unreliable source is not five independent pieces of evidence.
- Do not remove reverse image search entirely. It is one of the paper's most compelling features and can create a memorable demo, even if you use a prepared, reproducible example.
- Do not use only a generic supported/contradicted verdict. A misleading photograph can be authentic but used with a false date, location, or description. That distinction is central to the research paper.

Most importantly, the existing plan lacks a compelling answer to the question:

Why would a journalist, investigator, or member of the public use your agent instead of simply asking ChatGPT to fact-check a claim?

That is the question I would design the hackathon entry around.

## 2. The better use case: ContextLens — AI Misinformation Investigation Desk

## ContextLens

An autonomous evidence investigator for misleading images, conflicting narratives, and viral claims.

Target users: Local journalists, newsroom editors, independent fact-checkers, and community organisations.

Core problem: A viral post contains a genuine photograph but makes a misleading claim about when, where, or why it was taken. Different websites repeat conflicting explanations. A human investigator must identify the original context, distinguish independent evidence from repeated rumours, and decide whether the claim is safe to publish or share.

Agent's job: Investigate the claim, reconstruct the original context, identify competing narratives, cite the evidence, explain the discrepancies, and recommend what the user should do next.

### Why this is stronger

The project is not simply a fake-news classifier. It is an AI investigation assistant that helps people avoid publishing misleading information.

Consider the aircraft example from Figure 2 on page 3 of the CRAVE paper.

[IAF’s MiG-27 crashes near Jodhpur](https://images.openai.com/static-rsc-4/vStZ8HMX1DbQP5LW1UZuhH0CJUXVHQlqW9IR1hpUxAlifadRIcGgM7mXK5-iN8pvTQ0wv6t74KaVtQ4Inpb-KfHRP1hf3QqbRu_YN9cR9b09jvN4nl68KfkjtvrPMe09D7FWEpJT4RvFeAmcCI0sMMyhcws4GxKTobtTifFKCtE?purpose=inline)

Illustrative image search for the aircraft incident discussed in the paper; not authenticated evidence for a specific viral post.

A viral post claims:

> "This image shows an Indian fighter jet shot down by Pakistani forces."

The paper's example identifies evidence pointing to a MiG-27 crash in Jodhpur in 2016, while another narrative concerns aircraft shot down in 2019. The system must distinguish these events rather than simply find pages containing similar words.

ILLUSTRATIVE INVESTIGATION RESULT

Claim assessment

Misleading context

The image's documented context conflicts with the event described in the claim.

Claimed event

Military shootdown

Pakistan / India conflict

Evidence-supported context

Training crash

Jodhpur, India · 2016

Narratives discovered

Cluster A — Original aircraft incident

Evidence identifies the image as belonging to the earlier training crash.

Cluster B — Viral shootdown claim

Articles or posts associate the photograph with a different event.

Cluster C — Separate military incident

A real 2019 event provides context but does not establish the photograph's claimed origin.

Recommended action: Do not publish the image with the supplied caption. Replace it with a verified image or correct the context.

This is a proposed product output based on the paper's worked example, not a new live fact-check.

That output is more useful than a single "FALSE" label. It shows exactly how a true photograph and a true but separate incident can be combined into a misleading narrative.

## 3. Three possible use cases, ranked

These are my strategic estimates, not official judges' scores.

[Social media newswire vets user-generated content for reporters](https://images.openai.com/static-rsc-4/Y3_xrmfXvK-lb5VsdZdff3CyhXRH2QZua7LXuwIU3Q4UvoCHO1NKLxMCIY9Zlczv68huFz0ipsa0n3z6d6jvOjmzaQhUiC6957FyqksqnTBK5REcJjck-vpjx9P2ur3INQ6OTZBKfBxak7v1xSezD3iFCpKgM8SjDlQ6ZAvxUio?purpose=inline)

1\. ContextLens — Newsroom verification

Recommended

Journalists investigate viral photographs and contradictory claims before publishing.

High impact potential · Strong fit with CRAVE · Highly visual demo

[Training on Remote Sensing for Disaster Management - ForElite Training Institute](https://images.openai.com/static-rsc-4/sUYGLOMbXxw-Uc30_ZCdbp1qpMkM8WPfoIhN2Rw0oDt7Isk1RwuOQA4c93y0ju-YDpSXrutynvmAYCUmhpGq_PqAy1GBBFlgy9tENW4N1Po9Es0Kgck8LSklVMgZHuvLWwM_m0qyQSQyom0im8VD8lNLC9pdI3E6lbVo7s0hivI?purpose=inline)

2\. CrisisVerify — Emergency misinformation triage

Community responders investigate viral claims about floods, fires, evacuations, or aid availability.

Very high societal impact · Higher safety and accuracy burden · More difficult to validate

[Training on Treasury Compliance, Controls and Internal Audit - ForElite Training Institute](https://images.openai.com/static-rsc-4/3SPwE8Pafp-VNdSdMprX4KEz8H3dBG6UkbR7BcnC1seRQz5CM8NmF72I_ZHjVIScjlwIBVmLN2TP5FKv7odp2ooyI4jLqCa-a7pIv_BL3ixSiQdLzwhnU76h-LVBFooj4V5h1hsI-w2UUuEUG8xyfwwTIzb9UlVzAGCg-iJJekE?purpose=inline)

3\. ClaimAudit — Evidence-based compliance review

Investigators assess claims in corporate reports or sustainability statements against independent evidence.

Clear business value · Easier to demonstrate with structured data · Less distinctive reverse-image component

I would select ContextLens for this hackathon. CrisisVerify has potentially greater social consequences, but a rushed agent that produces incorrect emergency advice could cause harm. ContextLens provides a narrower and more credible demonstration of the same investigation capabilities.

## 4. How the research paper should influence the architecture

The CRAVE paper provides a useful foundation, but it should not be copied without changes.

| CRAVE research approach          | Proposed improvement                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Reverse image and text retrieval | Keep both, but allow a pre-indexed image-match dataset for the demo                      |
| K-means narrative clustering     | Start with semantic or event-based grouping; avoid forcing four clusters for every claim |
| LLM judgment per narrative       | Require exact supporting and conflicting evidence IDs                                    |
| Final true/misleading verdict    | Add out-of-context, disputed, and insufficient-evidence outcomes                         |
| 5W1H reasoning                   | Compare event identity, date, location, participants, and causal claims explicitly       |
| Evidence treated similarly       | Assess provenance, independence, relevance, and credibility                              |
| One investigation                | Reopen when new evidence arrives and explain what changed                                |

The paper itself identifies an important weakness: its reasoning can fail because sources are treated equally regardless of credibility. It also reports difficulties with clustering and retrieving sufficient evidence. Those are opportunities for your project to improve on the research rather than merely reproduce it.

The paper reports CRAVE accuracy of 0.82 on the Verite true-versus-fake task and 0.73 on its Divisive Posts dataset (Table II, page 7). These are the paper's reported benchmark results, not accuracy you can claim for ContextLens.

### A particularly important innovation: Evidence independence

Imagine five websites claiming the photograph shows a shootdown. Four copied the fifth website. Meanwhile, two independent archival sources identify an earlier crash.

A basic clustering system might count five sources against two and reach the wrong conclusion.

ContextLens should identify the five copied articles as one underlying evidence lineage. It should prioritise original reporting, dated archival records, and direct image matches rather than the number of websites repeating a claim.

This provides a meaningful reasoning innovation without requiring model training.

## 5. Proposed agent architecture

I would reuse your existing ResearchOS infrastructure and introduce three specialised components: an image provenance investigator, a narrative clustering engine, and an evidence-quality evaluator.

User submits a claim

Text + image or URL

Investigation Orchestrator

Meterless + Nemotron

Text evidence agent

Search, retrieve, extract

Image provenance agent

Match image and original context

Zetaris evidence repository

Articles · Image matches · Source metadata · Citations

Narrative clustering + evidence quality

Separate events, deduplicate sources, identify contradictions

Nemotron reasoning agents

Assess each cluster and synthesise the findings

Explainable investigation report

Verdict · Citations · Contradictions · Recommendation

H-MEM feedback loop

Remember findings and revise when new evidence arrives

The critical distinction is that the system should perform a genuine investigation, not just execute a fixed chain of LLM prompts. For example, when two clusters disagree about the date, the agent should formulate a new targeted search for original publication dates.

## 6. Hackathon scoring strategy

Using the six scoring categories from your hackathon brief, I would prioritise the following.

Impact

30 points

A journalist avoids publishing a demonstrably misleading image

Technical

20 points

Working multimodal retrieval, clustering, grounded reasoning

Innovation

15 points

Evidence lineage and autonomous contradiction resolution

Demo

15 points

Show the misleading claim, the investigation, and the corrected context

Product & UX

10 points

Clear investigation dashboard and exportable evidence report

Sponsor tech

10 points

Visible, meaningful integration with eligible sponsor technologies

The biggest opportunity is Impact, worth 30 points. I would demonstrate it through a concrete before-and-after workflow: a journalist receives a suspicious claim, ContextLens investigates it, and the journalist receives a corrected, source-backed explanation.

You cannot guarantee judges' scores, but that gives them a specific outcome to assess.

## 7. What I would build before submission

The organiser's public site currently lists the event as October 22–27, 2026, with a closing time of October 27 at 23:45 UTC.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://hackathon.genai.works\&sz=32)

Discover. Learn. Grow.

&#x20;Given the short window, I would use this scope:



Must build

Text claim submission, evidence retrieval through Zetaris, 2–4 meaningful narrative groups, source-backed Nemotron reasoning, an evidence comparison dashboard, and a final verdict with citations.

One high-impact visual feature

Prepare one authentic, documented image-provenance investigation with saved reverse-search matches. Clearly distinguish cached results from live searches.

One agentic feedback feature

Let the investigator discover a contradiction, initiate another targeted evidence search, and update its explanation. Save the investigation to H-MEM.

Defer

Full social-media integration, large-scale crawling, custom model training, multiple LLM debates, and unrestricted live reverse-image searching.

For evaluation, prepare at least three cases: one supported claim, one demonstrably misleading image-caption pair, and one genuinely unresolved claim. This tests whether the agent can abstain instead of manufacturing certainty.

A simple baseline comparison would also strengthen the entry: run the same claims through a single-prompt LLM and ContextLens, then compare citation validity, event-context identification, and correct abstention. Avoid presenting these as statistically significant results from only three examples.

## 8. Suggested two-minute demo

Demo timeline

120 seconds

1. 0:00–0:20 — The problem

   Show a viral image and a misleading caption. Explain that the photo may be real even though the story is wrong.
2. 0:20–0:45 — The investigation

   Submit the claim. Show text and image evidence retrieved from multiple sources, with Zetaris powering the evidence queries.
3. 0:45–1:10 — The reasoning

   Show separate narrative clusters. Highlight the contradiction between the image's original event and the claimed event, including the exact sources.
4. 1:10–1:35 — Autonomous follow-up

   Have Nemotron identify a missing date or location, trigger a targeted search, and update the conclusion.
5. 1:35–2:00 — The impact

   Display the verdict, verified context, source links, and editorial recommendation. Show that H-MEM can retain the investigation for later revision.

## 9. My final recommendation

I would pitch the product as:

> ContextLens — The AI agent that investigates not just whether a claim is false, but why it appears true.
>
> ContextLens helps journalists and fact-checkers investigate viral images and conflicting claims by autonomously retrieving evidence, reconstructing original context, identifying independent narratives, and producing transparent, source-backed editorial recommendations.

This combines the research value of CRAVE with a practical user need and a visually understandable demonstration.

One additional consideration: the public event page currently says teams of 1–5.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://hackathon.genai.works\&sz=32)

Discover. Learn. Grow.

&#x20;If you are still working with six people, check the official participation rules before submitting.



The one decision I would make next is whether to target journalists specifically or a broader misinformation-investigation audience. I recommend journalists because their workflow, decision, and measurable outcome are much easier to demonstrate. Once that is settled, the project can be narrowed into a concrete implementation plan for your existing Meterless and Zetaris application.