# Release Notes

Status: spec, not built. Flag: `release-notes` (off by default).

## Problem

We ship to prod nearly every day and nobody outside the PR can tell what changed. Announcements are fire-and-forget notification rows with no archive. There is no place to look back at what shipped.

## Goals

- Every user-visible change gets a short, readable entry with a demo video, published to `#dali-os-release-notes` and to `/release-notes`.
- Writing is cheap: an LLM drafts from merged PRs, Core edits and publishes.
- Video is automatic by default (scripted Playwright capture per PR); hand upload is a fallback.
- A weekly recap summarizes the week, it is not the primary channel.
- Entries can be limited to an audience (all members, or specific groups).

## Non-goals (MVP)

- Public changelog / RSS. Applicants and partners never see this.
- Per-block visibility inside an entry body.
- Email delivery (recap may join the digest later).
- Term-start "what changed since last term" roundup.

## What gets an entry

Write for a member using the platform, not for the people who built it. An entry is something a user would notice or want to know: a new feature, a new capability in an existing one, a changed workflow, a removed thing they relied on. Skip small bug fixes, copy tweaks, styling nudges, refactors, performance work nobody perceives, tests, CI and internal tooling. A fix earns an entry only if it was a known, widely felt problem. When it is unclear whether a change is user-facing, or which area it belongs to, ask rather than guess.

## Model

One table. Weekly recaps are derived, not stored as separate posts.

```prisma
enum ReleaseNoteStatus { Draft Published Dismissed }

model ReleaseNote {
  id            String            @id @default(cuid())
  status        ReleaseNoteStatus @default(Draft)
  title         String
  contentJson   Json?             // BlockNote body, same shape as BlogPost
  summary       String            // one line, used in Slack and the recap
  area          String?           // nav area slug: calendar, drive, hiring, ...
  prNumbers     Int[]             @default([])
  videoKey      String?           // S3 key, mp4
  videoSource   String?           // "scripted" | "upload"
  posterKey     String?           // S3 key, first-frame jpg
  highlight     Boolean           @default(false)
  allMembers    Boolean           @default(true)
  groupIds      String[]          @default([])
  slackTs       String?           // channel post ts, for threading the video
  draftedAt     DateTime          @default(now())
  publishedAt   DateTime?
  publishedById String?
  recapWeek     String?           // ISO week it was recapped in, e.g. "2026-W43"
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  @@index([status, publishedAt])
}
```

Audience mirrors `ScheduledAnnouncement` (`allMembers` + `groupIds`), stored as fields, no join table. Visible to a viewer when `allMembers` or the viewer is in any of `groupIds`. Core always sees everything.

Per-user "what's new" state: `User.releaseNotesSeenAt DateTime?`.

## Pipeline

### 1. Per PR: demo capture

- A PR that changes UI may add `dali-api/demos/<name>.demo.ts`: a Playwright script reusing `e2e/fixtures.ts` (seeded alumni, `dali_tabless=1`, embed iframe handling).
- Demo helpers (`demos/lib/`): injected cursor element with eased `mouse.move` steps, click ripple, `zoomTo(locator)` / `resetZoom()` via CSS transform on a wrapper, `pause(ms)`. Fixed 1280x720 viewport.
- New workflow job (in `test.yml` or a new `demo-capture.yml`) runs on PRs that touch `demos/`: same Postgres service container + prod build as e2e, records webm, ffmpeg to H.264 mp4 (`-crf 28 -pix_fmt yuv420p -movflags +faststart`, 720p, target under 3 MB) plus a poster jpg.
- Uploads to S3 at `release-notes/pr-<N>/<name>.mp4`. Upserts one PR comment (marker `<!-- demo-capture -->`) with the video link.
- Needs: AWS write creds as GitHub secrets scoped to the `release-notes/` prefix. Workflow change, flag in the PR.
- Recordings run against the CI database, not preview deploys (preview seed is unreliable on the 512 MB release VM).
- PR template gets a "Release note" section (one line of user-facing summary, left empty when not user-facing) and a pointer to the demo script docs.

### 2. On promotion to prod: drafting

- New job `release-notes-draft` in `app/jobs/registry.ts`, prod only, every 10 min.
- Reads `prod` HEAD via `githubAppClient()` (`app/lib/github.ts`). Stores last processed sha in the job's settings. On change, lists commits in `lastSha..head`, resolves associated merged PRs.
- Opt-in: drafts only PRs with text under the "Release note" heading in their body. HTML comments, blank lines and "None"/"N/A" don't count, so an untouched template means no entry.
- One LLM call per batch through `resolveAiProvider()` (`app/lib/ai.server.ts`) with PR title, body, labels, changed file paths and diff stats. Output (structured): entries `{ title, summary, body, area, prNumbers[] }`. Instructions: group related PRs, skip invisible work (refactors, tests, internal fixes), every entry cites at least one PR, never describe behavior not grounded in the PR text or diff.
- Creates `Draft` rows. Attaches `videoKey` when `release-notes/pr-<N>/` has a recording for any cited PR (first one wins, others listed in the editor).
- Usage recorded on `AiUsage` like other AI calls.
- Idempotent: dedup on the sorted `prNumbers` set; re-running the same range creates nothing.

### 3. Review: Core

- Core → Communications → Release notes (next to Announcements). Core only.
- Draft queue: title, summary, area, cited PRs (linked), video preview, audience, highlight toggle. Inline edit; open in `DocEditor` for the body.
- Video: swap between captured recordings, or upload one (`upload` source). Raise the per-route upload cap for video to 50 MB on this route only.
- Bulk actions: Publish selected, Dismiss selected.
- Drafts older than 7 days without action are not auto-posted; they appear in the next recap's "Also shipped" list as title only, then marked `Dismissed`.

### 4. Delivery

**Slack, per entry, on publish** (`allMembers` entries only):
- Via the outbox (`enqueueOutbound`, channel `slack_channel`, target `#dali-os-release-notes` channel id from job settings, dedupKey `release-note:<id>`).
- Block Kit: area tag, title, summary, "Open" button to `/release-notes/<id>`. Highlights get a leading "New" marker.
- mp4 uploaded as a thread reply via `files.uploadV2`. Store `slackTs`.
- Group-restricted entries do not go to Slack.

**In-app notification, highlights only**: new `release.published` event in `app/lib/notification-events.ts`, area "Release notes", defaults in-app + desktop on, email off, Slack DM off. Recipients resolved from the audience fields.

**Weekly recap**: job `release-notes-recap`, Thursday 10:00 ET (self-gated on wall clock like the digests; time in job settings).
- Collects entries published since the last recap.
- Slack: highlights first with summaries, then remaining entries grouped by area as one-line links. Group-restricted entries excluded.
- In-app `/release-notes?view=recaps` renders the same recap per viewer, so Core sees a "Core only" section the channel does not.
- Sets `recapWeek` on included rows.

**`/release-notes` page** (members only, behind flag):
- Reverse-chronological entries, filtered to what the viewer can see. Area filter. Video plays inline with poster.
- `/release-notes/:id` detail page (Slack and notifications link here).
- "Recaps" view grouped by ISO week.

**"What's new" indicator**: menu item with a dot when any visible entry has `publishedAt > releaseNotesSeenAt`. Visiting `/release-notes` updates the timestamp.

## Slack client additions

`app/slack/lib/slack-client.ts`:
- `postBlocks(channel, blocks, text)`: Block Kit post, returns ts.
- `uploadFileToThread(channel, threadTs, buffer, filename, title)`: `files.getUploadURLExternal` + `files.completeUploadExternal`.
- Bot needs `files:write` scope and must be a member of `#dali-os-release-notes`.
- Outbox `slack_channel` branch learns to send blocks and an optional file (from S3 key in `attachments`).

## Rollout

1. Schema + Core review page + `/release-notes` page + what's-new dot + manual "New draft". Flag on for Core only.
2. Slack per-entry posts + recap job.
3. Draft job (GitHub + LLM).
4. Demo capture workflow + helpers + PR template. Ship one demo script for an existing feature as the reference example.
5. Claude demo scripts (`demo-write.yml`): a ready PR into staging with a release-note line, app changes and no `demos/` file gets one written by Claude. Loop, capped at 3 attempts and a token budget: the writer writes and runs the script, CI records it, a separate reviewer session looks at frames from the video and passes it or says what to fix. A passing script is committed to the PR branch and Demo capture is dispatched for it. One attempt per PR (a `<!-- demo-write -->` comment marks it); re-run by hand. Author reviews the clip.
6. Flag to everyone.

Steps 1-4 are MVP; ordering is just for review size.

## Tests

- Audience visibility: allMembers, group member, non-member, Core override.
- Draft job: skip label, grouping, idempotent re-run over the same range, video attach by PR number, no-op when sha unchanged.
- Recap: excludes group-restricted from Slack, includes them in per-viewer recap, only entries since last recap, wall-clock gate.
- Slack: restricted entries never enqueue a channel post; dedup per entry.
- What's new: dot logic against `releaseNotesSeenAt`.
- Demo helpers: one e2e-style run of the reference script producing a non-empty mp4.

## Decided

- Claude demo scripts: triggered by the release-note line (itself opt-in), rollout step 5.
- GitHub App: assumed to have read access to `dali-os` PRs and commits; grant it if not.
- Stale drafts: auto-dismissed after 1 week into the recap's "Also shipped".
- Recording retention: S3 lifecycle rule deletes `release-notes/pr-*` after 60 days unless referenced by a published entry (published videos are copied to `release-notes/published/<id>.mp4` on publish).
- Desktop: no special coupling. Highlights already reach desktop banners via `release.published`.
