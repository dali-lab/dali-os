# Figma task linking — spec

_Drafted July 20, 2026. Companion to the task-artifacts work (`TaskFileLink` + versioned feedback on `ProjectFile`), which covers graphics/animation uploads. This spec covers the UI/UX side: linking Figma files to board tasks. Not yet built._

The GitHub issue mirror (`app/projects/lib/github-task-sync.ts`, `Task.githubRepo/githubIssueNumber/githubIssueUrl`) is the precedent: an optional per-task link to an external tool, a chip on the card, link/unlink in the modal, and a webhook route for inbound events. Figma follows the same shape in three tiers — Tier 1+2 ship together; Tier 3 is a fast-follow gated on a plan question.

---

## Tier 1 — link + live embed (no tokens)

**Task fields** (all nullable, populated together like the GitHub triple):

| Field | Example |
|---|---|
| `figmaUrl` | `https://www.figma.com/design/AbC123/Homepage?node-id=12-345` |
| `figmaFileKey` | `AbC123` |
| `figmaNodeId` | `12-345` (optional — deep-links to a specific frame) |

- Server parses the pasted URL (accept `/design/`, `/proto/`, `/board/` forms) into key + optional `node-id`. Reject anything that isn't a figma.com URL.
- **Modal**: "Link Figma file" paste field, mirroring the GitHub link/unlink block in `TaskModal.tsx`. **Card**: a Figma chip next to the GitHub chip.
- **Embed**: Embed Kit 2.0 iframe — `https://embed.figma.com/design/<key>?embed-host=dalios&client-id=$FIGMA_CLIENT_ID&node-id=<id>`. Render behind a "Preview" expander in the modal (embeds are heavy; don't load on every open). `node-id` makes the embed open scrolled to the linked frame — the natural fit for "task = redesign this screen."
- **Setup**: register one Figma OAuth app to get `FIGMA_CLIENT_ID` and register our origins (prod + staging + preview wildcard if allowed). No token exchange — the client id alone authorizes embedding. Private files show Figma's login screen to viewers without access, which is correct behavior for us.
- New route: `POST/DELETE /api/tasks/:id/figma` (mirror of `api.tasks.$id.github.ts`).

## Tier 2 — metadata enrichment (one lab-level token)

Make the chip informative: file name, thumbnail, "edited 2h ago" instead of a bare link.

- **Auth**: a single lab-level OAuth grant (a design lead's Figma account) with the `file_metadata:read` scope. Store tokens AES-256-GCM encrypted at rest, same pattern (and same key helper) as `GmailIntegration.oauthTokens`. One row; no per-user OAuth.
- **Fetch**: `GET /v1/files/:key/meta` → `name`, `thumbnail_url`, `last_touched_at`. This is a Tier-3 rate-limited endpoint — never call it on page load.
- **Cache**: columns on Task (`figmaFileName`, `figmaThumbnailUrl`, `figmaLastTouchedAt`) refreshed by a jobs-registry entry (`figma-metadata-refresh`, default 15 min, per-tick work bounded: only files linked to non-archived tasks, batched with backoff). Populated once synchronously at link time so the chip isn't blank for its first 15 minutes. If the same fileKey ends up linked from many tasks, promote to a `FigmaFileCache` table keyed by fileKey — start with per-task columns, N will be small.
- Token missing/expired → chip degrades to the Tier-1 bare link; never block linking on metadata.

## Tier 3 — webhooks (fast-follow, gated)

- **Gate**: confirm webhook availability on DALI's Figma Education team plan before building anything here.
- `POST /api/webhooks/figma` (mirror `api.webhooks.github.ts`, verify Figma's passcode), one webhook scoped to the team.
- `FILE_UPDATE` → invalidate/refresh the metadata cache for matching fileKeys. **Never a notification** — it fires on roughly every save batch.
- `FILE_COMMENT` → new registry event `task.figma_update` (defaults matching `task.github_update`): "New Figma comments on the linked file," notifying task assignees with a link out to Figma.

## Non-goals

- **No comment mirroring in either direction.** REST-posted comments attribute to the token owner, so DALI OS can't post "as" a mentor without per-user OAuth; and canvas-pinned comments in Figma are strictly better in context. Feedback on design work stays in Figma; the webhook (Tier 3) only signals that it exists.
- **No per-user Figma OAuth.**
- **No status sync** between Figma and task status.

## Open questions

1. Who owns the lab-level Figma grant (which account, and where the responsibility lands when that person graduates).
2. Education-plan webhook availability (blocks Tier 3 only).

## References

- Embed Kit 2.0: https://developers.figma.com/docs/embeds/embed-kit-2.0/
- File metadata endpoint + scopes: https://developers.figma.com/docs/rest-api/file-endpoints/ , https://developers.figma.com/docs/rest-api/scopes/
- Webhooks: https://developers.figma.com/docs/rest-api/webhooks-endpoints/
