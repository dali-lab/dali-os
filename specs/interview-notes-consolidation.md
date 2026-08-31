# Interview notes — drop the dead legacy layer, then consolidate onto the collab registry

Status: draft (2026-08-31). Owner: TBD. Depends on: nothing.

## What interview notes are today

There are **two live surfaces** (both kept — this is the product intent):

1. **Joint interview notes** — Yjs room `interview:{id}:notes`. A single shared
   minutes doc for the interview. Has **no source column**: it lives only in the
   collab room + `CollabDocument` snapshot (`persistence.ts:370` — "the
   collaborative doc supersedes it").
2. **Recommendation rationale** — Yjs room `interview:{id}:recommendation`,
   which **mirrors** `Interview.recommendationNotes` (seed reads it, syncBack
   writes it: `persistence.ts:81` / `:364`).

Plus two adjacent collab rooms:

- `interview:{id}:rec-notes-{assignmentId}` — **per-interviewer private notes**.
  **48 populated docs in prod.** The editor was removed; the read plumbing is
  retained (`InterviewNotesCard`, `get-application`,
  `api.domain-applications.$id.full-context.ts`, `domain-lead.application.$id`,
  `applications.$domainApplicationId`). **Historical, read-only — MUST KEEP.**
- `domainApplication:{id}:prepNote` — mirrors
  `DomainApplication.interviewPrepNote`.

All of the above are **hand-rolled** in `app/collab/persistence.ts`
(`loadInitialText` seed + `syncBack`) and `app/lib/collabAuth.ts`
(field-dispatched auth), *not* registered in `COLLAB_SOURCES`
(`app/collab/sources.ts`) the way `mentorNote` / `signing` / `form` / `rubric`
are.

### Confidentiality gate — why these are NOT Drive Pages

`collabAuth.ts` gates interview + domainApplication rooms on **signed cycle
confidentiality + an interview/delibs assignment (or Core)** — a hiring *policy*
gate, not Page/Drive sharing. That is why interview notes must stay
policy-gated collab rooms and **cannot** become literal Drive Pages. Any
consolidation preserves this gate.

## The dead legacy layer (`InterviewNoteVersion`)

An older append-only per-assignment notes model that the joint-notes doc
superseded:

- `model InterviewNoteVersion` (`schema.prisma:804`) + the `noteVersions`
  relation on `InterviewAssignment` (`schema.prisma:796`).
- **Verified empty in prod: 0 rows** (and 0 interviews with any).
- Consumers, all removable:
  - `persistence.ts:82-105` — joint-notes seed concatenates the latest
    `noteVersions[0].content` per assignment. With the table gone (and empty),
    this seed yields `""`; already-populated `interview:*:notes` rooms are
    unaffected (their content lives in `CollabDocument`, not here).
  - `api.cycles.$cycleId.my-interviews.ts:65` — a `noteVersions` include.
  - Two **uncalled** write/read routes (no client fetch references — grep
    confirmed):
    - `routes.ts:568` → `api.cycles.$cycleId.my-interviews.$interviewId.notes.ts`
    - `routes.ts:604` → `api.interview-assignments.$id.notes.ts`
  - `NoteVersionSchema` in `app/hiring/lib/note-schemas.ts` — used **only** by
    those two routes; the file drops with them.

Data-losing? The table is empty, so nothing is lost. Flag the drop in the PR
regardless (it's a `DROP TABLE`).

## Plan

Two phases — the safe deletion is independent of and lands before the riskier
registry migration.

### Phase 1 — delete the dead legacy layer (safe, self-contained)

1. Simplify `persistence.ts` joint-notes seed to not read `noteVersions`
   (return `""` for an unedited room; keep the recommendation/prepNote seeds).
2. Delete the two uncalled routes + their `routes.ts` entries + `note-schemas.ts`.
3. Remove the `noteVersions` include in `my-interviews.ts`.
4. New migration: drop `InterviewNoteVersion` + the relation.

No behavior change: the two live surfaces + rec-notes reads are untouched.

### Phase 2 — consolidate onto `COLLAB_SOURCES` (needs a signature change)

Goal: interview + domainApplication rooms go through the same
`seed`/`syncBack`/`authorize` registry as every other mirrored doc, instead of
bespoke branches in `persistence.ts` + `collabAuth.ts`.

**Obstacle (must decide first):** `CollabSource` today is *single-field per
entity* — `seed(id)`, `authorize(userSub, id)`, no `field`. Interview is
*multi-field* (`notes` / `recommendation` / `rec-notes-{assignmentId}`) with a
confidentiality precondition and a **dynamic per-assignment** gate on rec-notes.
Two ways to fit it:

- **(A) Make the registry field-aware** — extend `CollabSource` to
  `seed(id, field)` / `authorize(userSub, id, field)` (optional, defaulted for
  existing single-field sources). Cleanest long-term; touches the 5 existing
  sources' signatures (no behavior change for them).
- **(B) Register per sub-field** — pseudo-entities `interview:notes`,
  `interview:recommendation`, keep rec-notes' dynamic gate hand-rolled. Less
  invasive but leaks the field into the entity key.

Recommend **(A)**.

Then:

- Move the `recommendation` (↔ `Interview.recommendationNotes`) and `prepNote`
  (↔ `DomainApplication.interviewPrepNote`) mirrors into registry
  `seed`/`syncBack` — they're already clean single-column mirrors, just
  hand-rolled.
- Give **joint notes** a real mirror column so it participates uniformly:
  add `Interview.notesJson String?` (reuse-column-as-plaintext-mirror, same
  pattern as the BlockNote description mirrors). syncBack writes it; seed reads
  it; existing rooms lazily backfill on first load via `app/collab/read.ts`.
- Move the confidentiality + assignment gate into the registry `authorize`
  (field-aware), keeping the rec-notes "owning assignment only" branch.

## Open question for Kiran

The 48 `rec-notes-{assignmentId}` docs are currently **read-only history** (the
per-interviewer editor was removed; joint notes is the active surface). Options:

- **Leave read-only** (recommended) — the joint doc is where interviewers write
  now; the old private notes stay visible as history.
- **Restore the per-interviewer editor** — remount a rec-notes `DocEditor` on
  the interview page if interviewers want private-then-shared notes back.

No code assumes either; this is a product call.

## Explicitly out of scope

- The `InterviewNotesCard` display and the recommendation enum values.
- Turning interview notes into Drive Pages (confidentiality gate forbids it).
- Any change to the rec-notes read surfaces (Phase 1 & 2 both preserve them).

## Test focus

- Phase 1: an interview with existing joint-notes content still loads it after
  the seed simplification; the two dropped routes 404; rec-notes reads unchanged.
- Phase 2: recommendation + prepNote round-trip through the registry identically
  to today; joint-notes `notesJson` mirror populates; confidentiality gate still
  denies unsigned/unassigned; rec-notes still allows only the owning assignment.
