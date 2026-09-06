# Google reviewer preview environment

**Purpose:** stand up a **long-lived, frozen** PR preview so an external Google
reviewer (OAuth scope verification) can exercise real Google login plus the
Drive / Calendar / Gmail consent flows against a running instance.

This PR exists only to hold that preview open. **Do not push to this branch and
do not close this PR** — see [Freeze rules](#freeze-rules-important).

## Why a normal preview doesn't work out of the box

The preview pipeline (`.github/workflows/preview-deploy.yml`) deliberately stubs
Google auth:

- `GOOGLE_CLIENT_ID="preview-placeholder.apps.googleusercontent.com"` and no
  `GOOGLE_CLIENT_SECRET` → "Sign in with Google" is dead (`:208`).
- `NODE_ENV=development` → `/dev-login` and `/dev-login-as` are open and
  unauthenticated (anyone with the URL can log in as any seeded user, including
  admin — `app/lib/dev-login.ts`, `app/routes/dev-login-as.ts`).
- The Neon DB is dropped + reseeded on every push (`:90-91`); the app is torn
  down when the PR closes (`preview-teardown.yml`).

We override the first two by hand, and freeze the PR so the last two never fire.

## One-time setup (run once this PR's first preview deploy finishes)

Let `N` = this PR number, `APP=dali-api-pr-N`, `BASE=https://dali-api-pr-N.fly.dev`.

### 1. Point real Google credentials + prod mode at the app

```bash
flyctl secrets set -a "$APP" \
  GOOGLE_CLIENT_ID="<real client id>.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="<real client secret>" \
  NODE_ENV=production
```

- Real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` turn on the actual login and
  consent flows.
- `NODE_ENV=production` closes `/dev-login*` (the security hole) and makes the
  app behave like prod. Feature flags default **off** in production
  (`app/lib/feature-flags.server.ts`) — flip any the reviewer needs to see in
  Admin → Feature Flags.
- `API_BASE_URL` is already `$BASE` from the deploy; leave it. It is what builds
  every redirect URI below (`getApiBaseUrl()` in `app/lib/app-env.ts`).
- The random `JWT_SECRET` the deploy generated is fine; it persists because we
  never redeploy.

`flyctl secrets set` restarts the machine with the new values — no code redeploy.

### 2. Register redirect URIs on the OAuth client

In Google Cloud Console → the OAuth 2.0 client being verified → **Authorized
redirect URIs**, add (substitute the real `N`):

| Flow | Redirect URI | Why the reviewer needs it |
|---|---|---|
| First-party login | `https://dali-api-pr-N.fly.dev/auth/callback/google` | reach the app at all |
| Calendar link (calendar scope) | `https://dali-api-pr-N.fly.dev/integrations/calendar/google/callback` | restricted scope under review |
| Gmail authorize (gmail scope) | `https://dali-api-pr-N.fly.dev/admin/authorize-gmail/callback` | restricted scope under review |
| OAuth-as-provider (optional) | `https://dali-api-pr-N.fly.dev/oauth/callback/google` | only if the reviewer tests third-party OAuth-into-DALI |

No **Authorized JavaScript origins** entry is needed — login is a redirect
(authorization-code) flow, not the GIS one-tap button.

### 3. Give the reviewer a way in

Login branches on the Google-verified email (`app/routes/auth.callback.google.ts`):

- **`@dali.dartmouth.edu`** → full member experience. Requires a Dartmouth
  Google Workspace account. The calendar-link and gmail-authorize flows require
  an authenticated member (gmail requires an **admin**), so to let the reviewer
  reach the restricted-scope consent screens, hand them a working Dartmouth test
  account or screen-share the consent step.
- **Any other Google account** (e.g. the `@gmail.com` test account Google issues
  you) → first-time **partner** onboarding → lands in `/partner`. They can
  complete real Google login with no pre-provisioning, but only see the partner
  portal.

Pick based on what the reviewer must see. Restricted-scope (Drive/Calendar/Gmail)
verification needs the member/admin path, so a Dartmouth test identity is the
realistic option.

## Freeze rules (important)

- **Do not push to this branch.** Every push re-runs `preview-deploy.yml`, which
  resets `GOOGLE_CLIENT_ID` back to the placeholder and drops + reseeds the DB
  (`:90-91`, `:208`), undoing step 1.
- **Do not close or merge this PR.** `preview-teardown.yml` destroys the Fly app
  and Neon branch the moment the PR closes.
- The daily sweeper (`preview-sweeper.yml`) keeps any app whose PR is open, so an
  open + frozen PR survives indefinitely.

## Caveats

- `.fly.dev` is not a domain you own, so it cannot be a verified **Authorized
  domain** on the consent screen. Login and consent will *function* via the
  registered redirect URIs, but if the reviewer's checklist requires the app to
  run on your verified domain, this preview will not satisfy it — use a
  `dali.dartmouth.edu` subdomain pointed at a persistent Fly app instead.
- Preview machines scale to zero (`min_machines_running = 0`); the first hit
  after idle cold-starts for a few seconds. Warm `$BASE/login` before sending the
  reviewer the link.

## Teardown when done

Close this PR — `preview-teardown.yml` destroys the app and Neon branch
automatically. Then remove the redirect URIs added in step 2 from the OAuth
client.
