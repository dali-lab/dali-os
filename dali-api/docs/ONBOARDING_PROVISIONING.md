# Onboarding & acceptance provisioning — setup

When a hiring applicant is **accepted** (a Final decision is released), the
release path (`app/hiring/routes/api.decisions.$id.release.ts`) runs this
pipeline:

1. **Promote to member** + grant `DomainEligibility` P1 (always).
2. **Provision** (`app/members/lib/provisioning.server.ts`):
   - **Google Workspace** — create the member's `@dali.dartmouth.edu` account.
   - **Slack** — invite that DALI email to the workspace + announce to a channel.
   - **GitHub** — add the member's GitHub handle to their domain's org team.
3. **Welcome** (`app/members/lib/welcome.server.ts`):
   - A persistent **onboarding task** (the New Member Profile form). It clears
     only when the member submits the form — that submission also stamps
     `DALIMember.onboardedAt`.
   - A **welcome email** that tells them to log in with their new DALI email.
4. After onboarding, the **party tour** (`LaunchWelcome`) offers calendar
   connect (only if not already linked), app install, MCP, etc.

**Every external step is best-effort and env-gated.** When a step's
configuration is missing it reports `skipped` and the acceptance still
succeeds — nothing here blocks a release. So the code ships safely with none of
the below configured; configure each to turn the real integration on.

---

## Email recipient override (dev/staging)

Welcome/onboarding emails go to the **real candidate only in prod**
(`getAppEnv() === "prod"`). In dev/staging they're redirected to a test inbox.

| Env var | Default | Notes |
|---|---|---|
| `ONBOARDING_EMAIL_OVERRIDE` | `sophie.park@dali.dartmouth.edu` | dev/staging test inbox |
| `FRONTEND_URL` | — | base URL for the onboarding link in the email |

Email sending also needs the existing **`GmailIntegration`** row (the
`applications@…` service account) — set up via `/admin/authorize-gmail`. Without
it, emails are skipped (`emailSent=false`) but everything else proceeds.

---

## Google Workspace account creation — **action required**

Creating an `@dali.dartmouth.edu` account uses the **Admin SDK Directory API**,
which requires a Google **service account with domain-wide delegation**. None of
this exists yet — here's the one-time setup:

1. In Google Cloud, create (or reuse) a **service account**. Note its email and
   create a **JSON key**; you'll use the `client_email` and `private_key`.
2. Enable the **Admin SDK API** for that project.
3. In the **Google Workspace Admin console** → Security → API controls →
   **Domain-wide delegation**, add the service account's **client ID** with the
   scope: `https://www.googleapis.com/auth/admin.directory.user`.
4. Pick a **Workspace super-admin** account for the service account to
   impersonate (delegation requires acting *as* an admin).
5. Set these env vars (Fly secrets in dev/staging/prod):

| Env var | Example | Notes |
|---|---|---|
| `GOOGLE_WORKSPACE_SA_EMAIL` | `prov@…iam.gserviceaccount.com` | service account `client_email` |
| `GOOGLE_WORKSPACE_SA_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\n…` | the key; literal `\n` is fine, it's unescaped at runtime |
| `GOOGLE_WORKSPACE_ADMIN_EMAIL` | `admin@dali.dartmouth.edu` | the super-admin to impersonate |
| `GOOGLE_WORKSPACE_DOMAIN` | `dali.dartmouth.edu` | optional; defaults to this |

Behavior once set: a new member gets `first.last@dali.dartmouth.edu` created with
a random temp password and **forced password change on first login**; that email
is stored on `User.daliEmail`. Already-exists (409) is treated as success.
Until configured, this step reports `skipped`.

Code: `app/lib/google-workspace.ts` (uses `google-auth-library`, already a
dependency — no `googleapis` needed).

---

## Slack invite — **action required**

`admin.users.invite` requires an **admin-scoped token** (`admin.users:write`) on
a **Business+ / Enterprise Grid** workspace — distinct from the bot token.

| Env var | Notes |
|---|---|
| `SLACK_ADMIN_TOKEN` | admin token with `admin.users:write` |
| `SLACK_TEAM_ID` | the workspace/team id to invite into |
| `STAFFING_SLACK_CHANNEL` | channel the new member is invited into + announced to |

Until set, the invite reports `skipped`; the channel announcement still posts if
`SLACK_BOT_TOKEN` + `STAFFING_SLACK_CHANNEL` are present (existing behavior).

---

## GitHub team — already wired

Reuses the existing GitHub App (`GITHUB_ORG`, `GITHUB_APP_*`). On acceptance the
member's `User.githubUsername` (collected on the profile form, optional) is added
to their domain's org team (slug derived from the domain code). Skipped when the
org isn't set or the member has no GitHub username.

---

## The New Member Profile form

Onboarding *is* this form. It must exist and be **published** with question keys
matching `app/members/lib/profile-form-interpreter.ts`
(`profile.pronouns`, `profile.classYear`, `profile.major`, `profile.hometown`,
`profile.githubUsername`, `profile.linkedinUrl`). The seed
`prisma/seeds/accepted-applicants.ts` creates/publishes it (and re-versions it on
drift). In a fresh environment, run that seed once (or build the form in `/forms`
named exactly **"New Member Profile"** and publish it).
