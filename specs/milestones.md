# Milestones v2 — versioned, Drive-authored, project-assigned timelines

**Status:** in progress · branch `feat/milestones-v2` · flag `milestones-v2` (default off)

## Problem

A milestone is a week-by-week set of goals a project follows through a term (e.g.
"Week 0 — team + partner kickoff", "Week 3 — mentor mid-term review", "Week 8 —
code freeze"). Not every project runs the same milestones: new teams and returning
teams follow different cadences, and the lab wants to keep several sets around at
once and pick per project each term.

### What exists today

The current `/milestones` page (`app/routes/milestones.tsx`) is a **single lab-wide
term timeline**, not a per-project system:

- Models `TimelineWeek` / `TimelineMilestone` / `TimelineDomain` / `TimelineLane`,
  all scoped to a **Term**, seeded once per term from hardcoded `DEFAULT_WEEKS` in
  `app/lib/term-timeline.ts` (10 weeks, W0–W9).
- `TimelineMilestone` has `name`, `detail`, `labWide`, `position` and a `weekIndex`
  (0–9) on its parent week. `labWide=true` = a lab event every team shares
  (Prod Tales, Bug Hunt, Technigala); `labWide=false` = a team milestone each team
  hits on its own.
- There is **exactly one set per term** — no `projectId`, no "new vs returning"
  split anywhere. Core/Admin edit it in place; Home links to it via
  `MilestonesBanner`.

So the "two sets" the lab has in practice live in Notion / pre-migration docs, not
in this system. This feature generalizes the single lab timeline into **reusable,
versioned, collab-editable milestone sets that are assigned per project** and
rendered on each project's timeline.

## Decisions (locked with Kiran)

1. **One unified concept.** The lab term timeline and per-project sets are the same
   thing — one model, one global editing surface. No parallel systems.
2. **Authored in Drive**, versioned exactly like Forms/Rubrics (structured collab
   room + immutable version snapshots + lock-on-use).
3. **Manually assigned** per project at term setup (no auto-defaulting by
   new/returning).
4. **Lab-wide events author once.** `labWide` entries live in one designated Lab
   set and overlay every project timeline in addition to the project's assigned
   set — Technigala is not re-authored into every set.
5. **Boundary with the existing timeline chrome.** Only the *milestone entries*
   move into the unified model. `TimelineWeek`'s per-term chrome (week images,
   blurbs, domain lanes `TimelineDomain`/`TimelineLane`) stays as the lab
   `/milestones` presentation — absorbing lanes/images into per-project templates
   would balloon scope.

## Model

Mirrors `Form`/`FormVersion` (working draft + immutable snapshots, editable in
place until a version is pinned by real use).

```prisma
model MilestoneSet {                 // reusable named set (like Form)
  id           String   @id @default(cuid())
  name         String
  description  String?
  // Drive unified-tree placement (Page of kind=Folder). Null = unplaced.
  // Organisation only; never affects who can view/edit. Matches Form.folderPageId.
  folderPageId String?
  // The one set whose labWide entries overlay every project timeline. Exactly
  // one set carries this per lab; enforced in the app, not the schema.
  isLabWide    Boolean  @default(false)
  archivedAt   DateTime?
  createdById  String
  createdBy    User     @relation(fields: [createdById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // Editable working copy (structured collab room milestone:{id}:draft syncs
  // here on "Save draft"). NEVER read by the timeline — only versions are.
  draftEntries Json?

  versions     MilestoneSetVersion[]
  assignments  ProjectMilestoneAssignment[]

  @@index([folderPageId])
}

// Immutable-once-pinned snapshot of a set's entries. Editable/deletable in place
// until a ProjectMilestoneAssignment references it (mirrors FormVersion locking).
// entries: [{ id, weekIndex, name, detail, labWide }]
model MilestoneSetVersion {
  id            String   @id @default(cuid())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt   // fingerprint; bumps on in-place edit
  versionNumber Int
  entries       Json
  setId         String
  set           MilestoneSet @relation(fields: [setId], references: [id], onDelete: Cascade)
  createdById   String
  createdBy     User     @relation(fields: [createdById], references: [id])

  assignments   ProjectMilestoneAssignment[]

  @@unique([setId, versionNumber])
  @@index([setId, versionNumber])
}

// One pin per project per term. Set at term setup; overridable on the project.
model ProjectMilestoneAssignment {
  projectId  String
  termId     String
  versionId  String
  assignedById String?
  assignedAt DateTime @default(now())

  project    Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  term       Term                @relation(fields: [termId], references: [id])
  version    MilestoneSetVersion @relation(fields: [versionId], references: [id])

  @@id([projectId, termId])
  @@index([termId])
  @@index([versionId])
}
```

`isMilestoneVersionLocked(versionId)` = "any `ProjectMilestoneAssignment` references
it" — the exact `isFormVersionLocked` shape.

## Collab editing (structured room, like Forms/Rubrics)

- Room `milestone:{setId}:draft` — a structured `Y.Array` of entry maps, one per
  milestone (`{ id, weekIndex, name, detail, labWide }`), edited with
  `useSharedArray`.
- Register in three places, matching `form`/`rubric`:
  - `app/collab/roomName.ts` → `milestoneDraftName(setId)`.
  - `app/collab/sources.ts` → `COLLAB_SOURCES.milestone` with `structured: true`,
    no-op `syncBack` (explicit save writes the snapshot), `authorize = isCore`.
  - `authorizeCollabDoc` picks it up via the `COLLAB_SOURCES` fallback (no explicit
    branch needed; persistence reads `isStructuredRoom`).
- **Save draft** writes the live `Y.Array` → `MilestoneSet.draftEntries`.
  **Save version** freezes `draftEntries` into a new `MilestoneSetVersion`
  (versionNumber = max+1). Unlocked latest version is editable/deletable in place.

## Surfaces (UX)

1. **Global editing page** — Drive ▸ `Core ▸ Milestones` managed folder (via
   `ensureCoreDriveRoot`): a gallery of sets → open one → a **week-grid collab
   editor** (rows W0…W9, add/reorder milestones per week, `labWide` toggle, version
   history + Save version). Route `/core/milestones` is a thin Core-hub entry that
   links here. Gate: `isCore`.
2. **Term-setup assignment** — a Core surface listing the term's projects, each
   with a manual set/version dropdown → writes `ProjectMilestoneAssignment`. Plus a
   per-project override on the project page. No defaulting.
3. **Project timeline** — a slim **Milestones lane** pinned above the epic rows in
   `EpicsTimeline`, on the same weekly sprint-band grid it already draws
   (`PX_PER_DAY = 42`, bands anchored to term start). Entry `weekIndex N` →
   `termStart + N·7d`, so a milestone lands on the sprint band for that week. Team
   milestones render as markers; `labWide` entries from the Lab set overlay as
   coral flags. Click → detail popover.
4. **Home banner** — keep `MilestonesBanner`, now reading the unified Lab set.

## MCP

- `list_milestone_sets` — read sets + versions.
- `manage_milestone_set` (faceted) — `create` / `update` / `save_version` /
  `assign` / `list`, following the existing faceted-tool convention. `mcp:admin`
  scope / Core gate.

## Backfill / migration

- New migration adds the three models (additive, non-losing).
- A backfill lifts the current term's `TimelineMilestone` rows into a
  `MilestoneSet` named "Lab default" with `isLabWide = true`, `versionNumber 1`,
  entries `[{ weekIndex, name, detail, labWide }]`. The existing `/milestones`
  presentation keeps reading `TimelineWeek` for week chrome; only the milestone
  rows are mirrored into the set so assignment/rendering have a source.
- No hand-edits to applied migrations; `TimelineWeek`/lanes untouched.

## Phases

- **P0** — schema + migration + backfill + `milestones-v2` flag.
- **P1** — Drive `Core ▸ Milestones` folder, gallery, collab week-grid editor,
  Save draft / Save version, lock-on-use.
- **P2** — manual per-project assignment surface (term setup + project override).
- **P3** — timeline lane rendering + lab-wide overlay + detail popover.
- **P4** — MCP tools + Home banner rewire + `/core/milestones` hub entry.

Everything gated behind `milestones-v2` until Kiran validates on staging.

## Caveats / flags for review

- **Collab schema change** — new structured room; behaves like `form`/`rubric`, but
  flag in the PR per CLAUDE.md's CRDT-caution rule.
- **Migration is additive** but the backfill reads live term data — safe to re-run
  (idempotent on set name + term).
- **Timeline alignment** assumes `weekIndex` maps to `termStart + N·7d`; projects
  whose sprints don't start on the term boundary will show milestones on the
  calendar week, not necessarily aligned to a renamed sprint. Acceptable for v1.
