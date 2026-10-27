**SameStory** is a desk tool for one decision: a duty editor has a viral caption, and sometimes a photo, and must publish it, correct it, or hold it. The agent shows whether the cited pages are independent evidence or copies of one story, and whether a real photo has been attached to a different event.

This is a separate project. It needs its own evidence file, investigation rules, memory, and report. The demo corpus is prepared by hand. Image matches are rows already in that file, marked as cached.

## User

The user is a duty editor on a breaking post. They are about to publish a caption that already appears in several articles. They need a source-backed recommendation before they publish, not a true-or-false label.

The job is one claim at a time. The editor submits a prepared claim: caption text, the event the caption asserts, and an optional image id. SameStory returns lineages, event groups, a verdict, an action, and citations.

## Requirements

**Claim intake**

- A claim has an id, caption text, a claimed event id, and an optional image id.
- Event ids are labels in the evidence file, such as `jodhpur-2016` and `conflict-2019`. Version 1 does not infer the event from free text.
- The same claim id can be submitted again. The second run must show the stored decision beside the new one.

**Evidence**

Each evidence row has:

| Field | Meaning |
| --- | --- |
| `id` | Stable citation id |
| `claim_id` | Which prepared claim this row belongs to |
| `text` | Short excerpt the report may quote |
| `published_at` | Date |
| `event_id` | Event this row describes |
| `origin_id` | Shared id for an original and its copies |
| `kind` | `archive`, `wire`, or `repost` |
| `url` | Page the row came from |
| `image_match` | Whether this row is a cached match for the claim’s image |

- About twelve rows are enough for the scripted case.
- A `repost` shares the `origin_id` of the page it copies.
- The original in a lineage is the `archive` or `wire` row. If a lineage has only reposts, the earliest row stands in as the origin and the lineage is marked copy-only.

**Lineage and events**

- Rows with the same `origin_id` are one lineage. Five reposts of one wire count as one piece of evidence.
- Lineages group by `event_id`. The number of groups follows the data. The system does not force a fixed cluster count.
- The photo’s event is the `event_id` of the earliest `archive` or `wire` lineage with `image_match` true. If the claim has no image id, or no image-match row, the report states that image provenance is absent and judges the text lineages only.

**Verdict**

The verdict label is chosen by rules, in this order. The model does not choose it.

| Condition | Verdict | Action |
| --- | --- | --- |
| No lineage retrieved for the claim | `INSUFFICIENT` | Hold |
| At least one `archive` or `wire` lineage matches the photo’s event, that event differs from the claimed event, and every lineage for the claimed event is copy-only | `MISLEADING_CONTEXT` | Do not publish this caption. The photo’s recorded event is the other one |
| Two different events each have at least one `archive` or `wire` lineage | `DISPUTED` | Hold |
| Every `archive` or `wire` lineage has the claimed event, and the photo’s event is absent or matches it | `SUPPORTED` | Publish, citing those lineage origins |
| Any other mix | `INSUFFICIENT` | Hold |

**Explanation**

- One model call receives the claim, the lineages, the event groups, and the verdict the rules already chose.
- It may cite only row ids that were retrieved. Any other id is dropped from the report.
- If the model call fails, the report still shows the lineages, the verdict, and the action. The explanation line says the explanation was unavailable.

**Memory**

- After each run, store the claim id, caption, verdict, action, origin ids, and time.
- On a repeat, load that record and add one line: `UNCHANGED` when the verdict matches, or `REVISE` when it differs, including the previous verdict and action.

**Report**

The report has five parts, in this order: the claim, the lineages with copy counts, the event groups, the verdict and action, and the prior decision when one exists. Every cited id appears in the lineage list.

## System behaviour

**Misleading caption.** The editor submits the prepared aircraft claim. The caption says the photo shows an Indian fighter jet shot down by Pakistani forces. The claimed event is the 2019 conflict. Cached image rows point at a 2016 training crash near Jodhpur, backed by an archive or wire lineage. Pages that repeat the shootdown caption share one `origin_id` and are `repost`. The report shows two lineages, names the 2016 event as the photo’s recorded context, sets `MISLEADING_CONTEXT`, and recommends not publishing that caption.

**Supported caption.** The claimed event matches every independent archive or wire lineage, and the photo event matches or is absent. The verdict is `SUPPORTED`. The action is to publish, with the origin ids cited.

**Thin evidence.** The claim has a single copy-only lineage, or no rows. The verdict is `INSUFFICIENT`. The action is to hold. The report does not fill the gap with a guess.

**Conflicting records.** The 2016 event and the 2019 event each have their own archive or wire lineage. The verdict is `DISPUTED`. The action is to hold.

**Second submission.** The first run stored a desk note that treated the photo as a 2019 shootdown. A later run returns `MISLEADING_CONTEXT`. The report shows `REVISE` and the earlier action. A repeat that returns the same verdict shows `UNCHANGED`.

**Bad model output.** The model names a row id that is not in the retrieved set. That id is removed. The verdict and action stay as the rules set them.

## Architecture

```text
Editor
  │  claim id, caption, claimed event, optional image id
  ▼
Claim intake
  │
  ▼
Evidence store          Memory store
  │  rows for claim id     │  last decision for claim id
  ▼                        │
Investigation
  ├─ collapse rows by origin_id
  ├─ group lineages by event_id
  ├─ resolve the photo event from image_match rows
  ├─ apply the verdict rules
  ├─ one explanation call over those ids
  └─ drop unknown citation ids
  │
  ▼
Report
  └─ write the new decision to memory
```

Four pieces:

- **Evidence store.** One local file of claim rows. Retrieval is by `claim_id`. A later source can replace the file if it returns the same row fields.
- **Investigation.** Deterministic lineage collapse, event grouping, and the verdict table. This is the part a reviewer can check by hand.
- **Explanation model.** One call. It writes the paragraph. It does not change the verdict, the action, or the lineages.
- **Memory store.** One record per claim id, overwritten by the latest run. The report reads it before the new record is saved so the comparison uses the previous decision.

There is no crawler, no live reverse-image call, and no clustering model.

## Implementation phases

1. **Fixture.** Write the evidence file and three claims: misleading context, supported, and insufficient. Include the aircraft case as the misleading claim, with cached image rows and shared `origin_id` values on the reposts.
2. **Grouping.** Load one claim’s rows, collapse lineages, and print event groups with origin ids and copy counts. Check the aircraft case by hand: one lineage for the 2016 crash, one copy-only lineage for the shootdown caption.
3. **Verdict.** Apply the rule table and print the verdict and action for all three claims, including the disputed case once a second independent lineage is added to the fixture.
4. **Explanation.** Add the single model call and the citation filter. Confirm a planted unknown id never reaches the report, and that a failed call still prints the rule result.
5. **Memory and report.** Save the decision, run the misleading claim twice with a seeded prior note, and print `REVISE`. Format the five-part report.
6. **Demo pass.** Run the misleading claim, then the same claim again, then the supported claim and the insufficient claim. The first two runs are the demo. The other two show that the rules can agree and can abstain.

## Acceptance

- The aircraft claim prints two lineages, `MISLEADING_CONTEXT`, and “do not publish this caption.”
- Copy rows increase a lineage’s copy count and do not create a second lineage.
- The supported fixture prints `SUPPORTED` and cites only origin ids.
- The thin fixture prints `INSUFFICIENT` and “hold.”
- A second run on a changed verdict prints `REVISE` and the previous action.
- An unknown citation id from the model is absent from the report.
- With the model disabled, phases 2 and 3 still produce the verdict and the action.