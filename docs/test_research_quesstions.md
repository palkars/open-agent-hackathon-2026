# Test research questions

Paste one question into the ResearchOS question box. These are research questions, not lookups of a paper id. H-MEM shows whether the claim was stored before. Zetaris supplies the papers whose wording matches the question.

| Question outcome | Papers the question loads | What those papers say |
|---|---|---|
| SUPPORTED | P232, P233 | A Lattice Ballot collects anonymous votes without a tallying authority. Both experiments passed. |
| CONTRADICTED | P236, P237 | RSA public key cryptography cannot be implemented to run in polynomial time. |
| MIXED | P234, P235 | P234 says a Cedar Modulus remains safe against a laptop factoring effort. P235 says a laptop factoring effort breaks it, and that experiment failed. |
| INSUFFICIENT | none | Nothing mentions Helios9. |

Restart the ResearchOS server before asking these. Zetaris has to be reading `build-oct26/research-os/data`. An earlier copy in the NDP file store does not contain P232–P237.

The labels are what the LLM reasoner should return. The deterministic reasoner still answers `INSUFFICIENT` unless the question is about post-quantum anonymity and traceability without an opener.

## SUPPORTED

Can a Lattice Ballot collect anonymous votes without a tallying authority?

P232 and P233 both say yes, and both experiments passed.

## CONTRADICTED

Can RSA public key cryptography be implemented to run in polynomial time?

P236 and P237 both say it cannot. The evidence denies the question.

## MIXED

Can a Cedar Modulus remain safe against a laptop factoring effort?

P234 says it remains safe. P235 says a laptop factoring effort breaks a Cedar Modulus.

## INSUFFICIENT

Can a Helios9 relay settle in one millisecond?

No paper is about a Helios9 relay, so there is no evidence for or against an answer.
