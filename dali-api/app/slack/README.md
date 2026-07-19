# Slack bug-report bot

Webhook receiver embedded in `dali-api`. A teammate `@dali-os-bot` with the word "bug" in the message → bot files the message (or the whole thread, if the mention is inside one) as a GitHub issue on `dali-lab/dali-os` and replies with the issue URL.

## Files

- `routes/api.slack.events.ts` — Events API webhook (`POST /api/slack/events`). Verifies signature, dispatches `app_mention`.
- `routes/api.slack.interactivity.ts` — Stub for buttons/modals later (`POST /api/slack/interactivity`). Currently just signature-verifies.
- `lib/verify-signature.ts` — Slack v0 HMAC-SHA256 signature check + 5-minute replay window.
- `lib/slack-client.ts` — Thin `@slack/web-api` wrapper.
- `lib/handle-mention.ts` — Reacts to `@bot … bug …`; files an issue immediately and posts the URL in-thread.
- `lib/format-issue.ts` — Pure function: Slack thread → GitHub issue title/body. Attachments are noted by name and linked back to the Slack thread (no upload to GitHub).
- GitHub primitives live in `~/lib/github.ts` (shared with the projects/tasks integration).

## How the trigger works

A mention fires when **both** of these are true:

1. `@dali-os-bot` (or whatever the bot is named) appears in the message text.
2. The word `bug` appears anywhere in the same message (case-insensitive; substrings match — `bug`, `bugs`, `debugging` all count).

If the mention is in a thread, **the entire thread** becomes the issue body. If the mention is on a top-level message, **just that message** becomes the issue body and the bot's URL reply starts a new thread under it.

Slack retries are de-duped — if Slack re-delivers the same `app_mention` event, the unique index on `(slackChannelId, previewMessageTs)` prevents a duplicate issue.

## Required env vars (see `dali-api/.env.example`)

| Var | Notes |
|---|---|
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → Signing Secret. Empty disables both endpoints (503). |
| `SLACK_BOT_TOKEN` | `xoxb-…` from OAuth & Permissions. |
| `GITHUB_APP_ID` | Public, not a secret. |
| `GITHUB_APP_INSTALLATION_ID` | Visible in the app's installation page URL. |
| `GITHUB_APP_PRIVATE_KEY` | PEM. In Fly, set with `$(cat path/to/key.pem)` so newlines are preserved. |
| `GITHUB_ISSUES_REPO` | `owner/repo`. Default `dali-lab/dali-os`. |

## One-time Slack app setup

1. Create at https://api.slack.com/apps.
2. **Bot Token Scopes**: `app_mentions:read`, `channels:history`, `chat:write` (add `groups:history` for private channels).
3. **Event Subscriptions** → enable. Request URL per env:
   - dev: `https://os-dev.dali.dartmouth.edu/api/slack/events`
   - staging: `https://os-staging.dali.dartmouth.edu/api/slack/events`
   - prod: `https://os.dali.dartmouth.edu/api/slack/events`
   Subscribed bot events: `app_mention` (only — no reactions needed).
4. **Interactivity & Shortcuts** → enable. Request URL: `…/api/slack/interactivity` (same hosts). Just reserves the slot for v2 features.
5. Install to workspace. Invite the bot to your bug-report channel.

Slack will verify the request URL once on save — the route returns the `challenge` token automatically.

## One-time GitHub App setup

1. Create at https://github.com/organizations/dali-lab/settings/apps/new.
2. Permissions:
   - Repository → Issues: **Read & write**
3. Install on `dali-lab/dali-os` (the repo `GITHUB_ISSUES_REPO` points at).
4. Generate a private key (`.pem` download). Store as `GITHUB_APP_PRIVATE_KEY` Fly secret.
5. The installation ID is in the install URL (`/settings/installations/<id>`).

## Smoke test

1. In a test channel, post a top-level message describing a bug.
2. Reply in-thread: `@dali-os-bot bug` (or any message that mentions the bot AND contains "bug").
3. Within ~5s the bot replies in the thread with the new GitHub issue URL, which Slack unfurls into a rich preview card.
4. The issue exists on `GITHUB_ISSUES_REPO` with the whole thread quoted in the body.

## What's not done

- No retry queue for transient GH 5xx — the bot posts the error in-thread and the user can re-mention to retry.
- No channel→repo routing. Every issue lands in `GITHUB_ISSUES_REPO`.
- No interactivity buttons yet; that route is just a verified 200.
