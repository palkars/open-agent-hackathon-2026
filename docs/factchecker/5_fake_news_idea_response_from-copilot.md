SameStory
The AI Agent That Reconstructs the True Story Behind Conflicting Information
Executive Summary

SameStory is an autonomous investigation agent that determines whether multiple pieces of information are describing the same real-world event or different events that have been conflated.

Rather than answering:

"Is this claim true?"

SameStory answers:

"What actually happened, which narratives describe the same event, which information is independent, and what is the most evidence-supported version of the story?"

This is a subtle but extremely important shift.

Most misinformation is not completely fabricated. The CRAVE paper itself highlights that real images, real events and real facts are often reused in misleading contexts.

SameStory focuses on:

context reconstruction
evidence provenance
narrative reconciliation
source independence
explainable reasoning

This creates a much stronger impact story than a generic fact checker while remaining technically feasible within the hackathon timeframe.

Problem Statement

Information consumers today face:

conflicting news articles
misleading image reuse
social media claims
edited narratives
AI-generated misinformation
copied reporting presented as independent evidence

Current systems typically provide:

True
False
Unclear


but do not explain:

what actually happened
where the information originated
which sources copied each other
what evidence changed the outcome

As a result, users still need to perform manual investigation.

Vision

SameStory acts like an investigative researcher.

The agent autonomously:

gathers evidence
discovers event narratives
identifies duplicate reporting
finds contradictions
reconstructs the most likely timeline
explains its reasoning

The outcome is not merely a verdict.

The outcome is a reconstructed story.

Target Users
Primary User
Investigative Journalist

Needs to verify:

viral images
breaking news
conflicting reports
emerging stories

Decision:

Can I publish this?

Secondary Users
Fact Checking Organisations

Need:

evidence-backed investigations
explanation generation
Public Sector Analysts

Need:

evaluate information sources
identify narrative manipulation
Researchers

Need:

understand information lineage
analyse competing narratives
Enterprise Risk Teams

Need:

assess reliability of external claims
investigate market rumours
Core User Journey
Input

User submits:

Claim
Image
Article
Tweet
URL
Document


Example:

"This aircraft was shot down during military action."

Investigation

SameStory:

Stage 1

Retrieve evidence

Sources:

news archives
fact-checking sites
indexed datasets
image provenance
internal repositories
Stage 2

Create evidence graph

Evidence A
Evidence B
Evidence C


Relationships:

supports
contradicts
cites
copies
extends

Stage 3

Narrative discovery

Identify:

Narrative 1
Training accident

Narrative 2
Military engagement

Narrative 3
Fact-check explanation

Stage 4

Cluster evaluation

Independent reasoning performed on:

evidence quality
source credibility
temporal consistency
geographical consistency
Stage 5

Story reconstruction

Agent produces:

Most likely timeline


and

Evidence-backed conclusion

Expected Output

Example:

SameStory Report
Event Classification

Likely different events were conflated.

Narrative Groups
Story A

Military aircraft training crash.

Confidence: 92%

Supporting evidence: 5 independent sources

Story B

Military confrontation.

Confidence: 71%

Supporting evidence: 2 independent sources

Contradictions

The image appears in Story A but is referenced as Story B.

Image reuse likely caused confusion.

Final Story

The image originates from the training crash.

A later military incident appears to have been incorrectly associated with the image.

Recommendation

Do not reuse image without correction.

Core Innovation

Most systems count sources.

SameStory evaluates source independence.

Example:

Traditional Reasoning
20 websites support claim


Conclusion:

Strong evidence.

SameStory Reasoning
20 websites
↓
18 copied same article
↓
2 independent sources


Conclusion:

Weak evidence.

Key Differentiators
1. Story Reconstruction

Not:

True / False


Instead:

What happened?

2. Evidence Independence

Not:

How many sources?


Instead:

How many independent sources?

3. Narrative Understanding

Not:

One answer


Instead:

Multiple competing explanations

4. Explainable Investigation

Every statement links back to evidence.

5. Human-Centric Output

Produces:

reconstructed timeline
narrative map
confidence levels
recommendations
Proposed Architecture
                   ┌───────────────────┐
                   │      User         │
                   └─────────┬─────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │ Investigation Gateway  │
                └─────────┬──────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼

 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │Text Evidence │ │Image Proven. │ │Memory Agent │
 │Retrieval     │ │Agent         │ │(H-MEM)      │
 └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
        │                │                │
        └────────────────┼────────────────┘
                         ▼

              ┌────────────────────┐
              │ Zetaris Data Fabric │
              └─────────┬──────────┘
                        ▼

         ┌─────────────────────────────┐
         │ Evidence Knowledge Graph    │
         └────────────┬────────────────┘
                      ▼

         ┌─────────────────────────────┐
         │ Narrative Discovery Agent   │
         └────────────┬────────────────┘
                      ▼

         ┌─────────────────────────────┐
         │ Source Independence Agent   │
         └────────────┬────────────────┘
                      ▼

         ┌─────────────────────────────┐
         │ Nemotron Reasoning Agents   │
         └────────────┬────────────────┘
                      ▼

         ┌─────────────────────────────┐
         │ Story Reconstruction Agent  │
         └────────────┬────────────────┘
                      ▼

         ┌─────────────────────────────┐
         │ SameStory Investigation     │
         │ Report                      │
         └─────────────────────────────┘

Sponsor Technology Mapping
Component	TechnologyOrchestration	Meterless
Data Retrieval	Zetaris
Reasoning	NVIDIA Nemotron
Memory	H-MEM
Investigation Workflow	Open Agent Framework
Knowledge Graph	Custom Layer
Narrative Clustering	Semantic Clustering
Agent Behaviour
Planner Agent

Creates investigation plan.

Questions:

What evidence is missing?
Which source should be checked next?
Retrieval Agent

Collects:

articles
reports
image matches
archived references
Provenance Agent

Determines:

first appearance
image origin
evidence lineage
Narrative Agent

Groups evidence into:

event narratives
competing viewpoints
supporting clusters
Reasoning Agent

Evaluates:

support
contradiction
evidence quality
Reconstruction Agent

Creates:

timeline
final story
recommendation
Hackathon Scope
Phase 1 (Must Build)
Functional MVP

Input:

claim
image
URL

Features:

evidence retrieval
narrative clustering
reasoning
final report

Deliverable:

Claim
↓
Evidence
↓
Narratives
↓
Conclusion

Phase 2
Source Independence

Identify:

Original report
Copied report
Derived report


Produce:

Evidence lineage graph

Phase 3
Agentic Investigation

System identifies gaps.

Example:

Date missing


Agent automatically launches:

Targeted date search


without user intervention.

Phase 4
Memory

Store investigations.

Later evidence:

New article discovered


Agent reopens investigation and explains:

What changed?

Demo Scenario
Scenario

Viral image plus claim.

User submits:

"This image shows a fighter aircraft shot down in military action."

System
Reverse image retrieval
Evidence gathering
Narrative clustering
Source lineage analysis
Reasoning
Story reconstruction
Outcome

Instead of:

False


SameStory produces:

The image originated from a 2016 training crash.

The later military confrontation is real,
but there is no evidence that this image
came from that event.

The claim combines two separate stories.


This makes the reasoning visible, intuitive and directly aligned to Track 2: The Agent That Can Explain Why.

Final Pitch

SameStory is an autonomous investigation agent that reconstructs the true story behind conflicting information by discovering narratives, tracing evidence provenance, measuring source independence, and generating transparent evidence-backed explanations.

Instead of asking "Is this true?", SameStory answers "What actually happened, why do different versions exist, and which evidence should be trusted?".

Of all the directions discussed so far, I believe SameStory is the strongest balance of impact, technical feasibility, innovation, and sponsor technology alignment for Track 2 because it transforms a fact-checking system into an explainable, agentic investigation platform.