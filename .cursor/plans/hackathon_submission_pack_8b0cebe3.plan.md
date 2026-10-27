---
name: Hackathon submission pack
overview: "Prepare the written HackOS submission pack from the current ResearchOS repo: a judge-facing README section, a six-slide deck, and a timed demo script. Recording the video and uploading to HackOS stay with you."
todos:
  - id: readme-sponsor
    content: Add the judge-facing sponsor, engine, and test section to research-os/README.md
    status: completed
  - id: slides
    content: Add a six-slide slides.html with no new dependencies
    status: pending
  - id: demo-script
    content: Add DEMO-SCRIPT.md for a two-minute Nightshift recording with secrets off screen
    status: pending
isProject: false
---

# Hackathon submission pack

Budget is about 4 hours of repo work. This produces the written pieces the checklist asks for. It does not record the video, push the repo, or submit on HackOS.

The video only counts if you record one live question with `RESEARCH_REASONER=llm`, Nightshift answers it, and no runtime token or NVIDIA key is on screen. An AI-generated clip does not meet that rule.

## What already exists

- README and architecture: [build-oct26/research-os/README.md](build-oct26/research-os/README.md)
- Page walkthrough and screenshots: [build-oct26/research-os/USER-GUIDE.md](build-oct26/research-os/USER-GUIDE.md)
- Offline engine proof: [build-oct26/research-os/test-markovian.ts](build-oct26/research-os/test-markovian.ts) (cold run 3 chunks, warm run 2)
- Nightshift proof: [build-oct26/research-os/test-llm-reasoner.ts](build-oct26/research-os/test-llm-reasoner.ts)
- Demo question: the SUPPORTED line in [docs/test_research_quesstions.md](docs/test_research_quesstions.md)
- Secrets stay out: [build-oct26/research-os/.env](build-oct26/research-os/.env) is listed in [.gitignore](.gitignore)

H-MEM and Markovian are the vendored Meterless reference engines under `research-os/vendor`. The README will say that plainly. It will not claim either engine was written from scratch.

## 1. README sponsor section

Add one section near the top of [build-oct26/research-os/README.md](build-oct26/research-os/README.md), after the opening screenshots, that a judge can read without the rest of the guide:

- Zetaris supplies papers, notes, and experiments. The NVIDIA key never enters this repo. Nightshift holds it and ResearchOS calls `http://127.0.0.1:8088/v1` with the runtime token and `METERLESS_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b`.
- Meterless engines used: H-MEM (`vendor/hmem`, store in `.memory`) and Markovian (`vendor/markovian`, at most 3 chunks). One sentence on what each does in a warm run.
- The test that shows Markovian works, with Nightshift stopped: `npx tsx research-os/test-markovian.ts` from `build-oct26`. Expected result: cold 3 chunks, warm 2.
- The test that shows one real Nightshift request: `npx tsx research-os/test-llm-reasoner.ts`. Expected result: an assessment whose paper ids come from the evidence that was sent.
- Point at the deck and the demo script.

Leave the existing setup, CLI, and test list in place. Do not paste tokens, passwords, or the contents of `.env`.

## 2. Six-slide deck

Add [build-oct26/research-os/slides.html](build-oct26/research-os/slides.html). One HTML file, no new dependencies, arrow keys to move between slides, so it can be presented or printed to PDF.

- Problem: a research question needs prior memory and current evidence, and the conclusion has to say whether the evidence supports it.
- What ResearchOS does: one question, four panes, one assessment (`SUPPORTED`, `CONTRADICTED`, `MIXED`, or `INSUFFICIENT`).
- Path: H-MEM recall, Markovian chunks, Zetaris rows, Nemotron through Nightshift, contradiction check, store the finding.
- One result: “Can a Lattice Ballot collect anonymous votes without a tallying authority?” loads P232 and P233 and should return `SUPPORTED`.
- What stays local: papers, H-MEM, and Markovian stay on the machine. The NVIDIA key stays in Nightshift. The only outbound model call is the Nightshift runtime.
- Proof and how to run: the two test commands above, then `npx tsx research-os/ui/server.ts` and open the UI.

## 3. Demo script

Add [build-oct26/research-os/DEMO-SCRIPT.md](build-oct26/research-os/DEMO-SCRIPT.md). Target length about 2 minutes, inside the 1 to 4 minute limit.

- Before recording: Nightshift running, `GET /v1/models` succeeds, Zetaris up, server started with `RESEARCH_REASONER=llm`. If the UI is already on port 4180, keep that port. Do not open `.env`, the Nightshift token panel, or a terminal that printed the token.
- Shot 1, about 20 seconds: the question box only. Paste “Can a Lattice Ballot collect anonymous votes without a tallying authority?”
- Shot 2, about 60 seconds: press Run research and wait. Show the Nemotron assessment, then H-MEM, the Zetaris paper ids, and the Markovian trace ending in a conclusion.
- Shot 3, about 30 seconds: say the two engines and the two tests. Do not run a second question on camera.
- If that question loads no papers, stop and use the trusted-opener question already shown in the README screenshots. That means Zetaris is still serving an older copy, and the take would not match the deck.

## After these files

You still record the take and upload the video, the deck, and the repo link on HackOS. Say if you want the repo pushed. The 4 hours do not include a retake if Nightshift or Zetaris fails.
