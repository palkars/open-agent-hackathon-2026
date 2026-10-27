---
name: RSA mock dataset
overview: Append 200 mocked RSA and integer-factorization papers, 350 notes, and 200 experiments to the existing ResearchOS data files, including five explicit contradiction pairs.
todos:
  - id: papers
    content: Append P032–P231 RSA and integer-factorization rows to papers.csv, including five opposing claim pairs.
    status: completed
  - id: notes
    content: "Append N031–N380 to notes.json: one note per paper, plus limitations, open questions, and contradiction notes."
    status: completed
  - id: experiments
    content: Append E031–E230 to experiments.csv with varied mock timings and FAIL or DEGRADED on the break claims.
    status: completed
isProject: false
---

# RSA mock papers, notes, and experiments

Append mocked rows to the three existing files. Leave P001–P031, N001–N030, and E001–E030 unchanged. New ids start at the next free number: papers **P032–P231**, notes **N031–N380**, experiments **E031–E230**.

Files:

- [build-oct26/research-os/data/papers.csv](build-oct26/research-os/data/papers.csv)
- [build-oct26/research-os/data/notes.json](build-oct26/research-os/data/notes.json)
- [build-oct26/research-os/data/experiments.csv](build-oct26/research-os/data/experiments.csv)

Generate the rows with a one-off script so the ids, contradiction pairs, and CSV quoting stay consistent, then delete the script. The deliverable is the three data files.

## Papers (200)

Match the current header and `MOCK` style: `Mock Author N et al.`, venue `Mock Security Symposium`, `source_type` `MOCK`, `doi_or_url` `mock://researchos/Pxxx`. `crypto_family` stays `classical` and `crypto_method` is RSA or a factoring method (RSA-CRT, multiprime RSA, quadratic sieve, number field sieve, Coppersmith, Wiener). Years run from 1977 through the 2020s. `provides_anonymity`, `provides_traceability`, and `trusted_opener_required` are `False`, so these rows do not match the post-quantum anonymity query.

Topics cycle through the RSA lineage: the 1970s public-key construction, textbook RSA, PKCS#1 and OAEP padding, CRT and multiprime speedups, small-exponent and low-private-exponent attacks, Fermat and Pollard methods, quadratic sieve, number field sieve, and the relationship between breaking RSA and integer factorization.

## Five contradictions

Ten papers form five opposing pairs. Each side’s `key_claim` states the opposite of the other, and each side gets a note that names the other paper id.

- 1024-bit RSA remains operationally safe versus 1024-bit RSA is already within practical factoring range
- Public exponent 3 is unsafe versus exponent 3 with OAEP is safe
- Breaking RSA is the same problem as general integer factorization versus RSA can fail without a general factoring algorithm
- Near-term quantum hardware makes 2048-bit RSA obsolete versus only toy moduli have been factored
- Multiprime RSA is as hard to factor as two-prime RSA versus extra primes make the number field sieve easier

## Notes (350)

Append to the JSON array, using the existing fields: `note_id`, `paper_id`, `date`, `note_type` `research_note`, `stance`, `confidence`, `note`, `research_question`, `tags`.

- 200 notes, one per new paper: `SUPPORTS`, restating that paper’s claim or conclusion
- 100 extra notes on P032–P131: `LIMITATION`
- 40 notes on P132–P171: `OPEN_QUESTION`
- 10 notes, two per contradiction pair: each cites the opposing paper id

Every new paper has at least one note. Tags use `rsa`, `public-key`, and `integer-factorization`. The research question asks whether RSA security reduces to integer factorization.

## Experiments (200)

One row per new paper, same columns as [experiments.csv](build-oct26/research-os/data/experiments.csv). `is_mock` is `True`. Platforms rotate through Raspberry Pi 5, Simulated IoT node, and MacBook Pro M-series. Security levels are 1024-bit, 2048-bit, 3072-bit, and 4096-bit. Sign, verify, size, memory, and communication values vary by modulus size. Most results are `PASS`. The five papers that claim a break or a failed assumption use `FAIL` or `DEGRADED`.
