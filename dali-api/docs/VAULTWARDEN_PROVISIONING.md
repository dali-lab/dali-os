# Vaultwarden project provisioning

The **"Set up Vaultwarden group"** staffing-finalize automation (and the
`POST /api/staffing/sync-vault` sweep) add a project's staffed roster to that
project's Vaultwarden **group** and grant the group access to the project's
secrets **collection** — the analog of the GitHub team automation.

It is **add-only and idempotent**: it invites/adds members and never removes
them (departures are handled out of band, like the GitHub sync).

## What is and isn't automated

Vaultwarden is end-to-end encrypted, and the integration authenticates with an
**API key only** (no master password), so it can only do access-control
operations — not crypto ones:

| Operation | Automated? | Why |
|---|---|---|
| Create/find a **group** by name | ✅ | Group names are plaintext |
| Add members to the group | ✅ | Access-control mapping |
| **Invite** a new member by email | ✅ | Vaultwarden emails the join link |
| Grant the group an existing **collection** (by id) | ✅ | Access-control mapping |
| **Confirm** a member | ❌ manual | Re-encrypts the org key to the member's public key (needs the org symmetric key) |
| **Create/rename** a collection | ❌ manual | Collection names are encrypted with the org key |

Members are reported as **awaiting confirmation** until an admin confirms them
once in the web vault — the analog of GitHub's "must enable 2FA" per-member note.
Members are matched by **`User.daliEmail`**; anyone without a DALI email is
reported, not synced.

## One-time setup

1. **Create a bot account** in Vaultwarden (e.g. `dali-os-bot@dali.dartmouth.edu`).
2. **Invite it to the org** as **Owner** (or Admin) and **confirm it once** by
   hand (this is the crypto step a human must do).
3. **Generate its personal API key**: web vault → Account settings → Security →
   Keys → *View API Key*. This yields `client_id` (`user.<uuid>`) and
   `client_secret`.
4. **Find the org id** (the GUID in the org's web-vault URL) → `VAULTWARDEN_ORG_ID`.
5. Set the env vars (see `.env.example`):
   - `VAULTWARDEN_URL` — base URL, no trailing slash
   - `VAULTWARDEN_ORG_ID`
   - `VAULTWARDEN_CLIENT_ID`
   - `VAULTWARDEN_CLIENT_SECRET`

## Per-project setup

- The **group** is auto-created by project name on first run and its id is
  persisted to `Project.vaultwardenGroupId` (survives a project rename).
- The **collection** is *not* auto-created. Create the project's secrets
  collection by hand, copy its id, and paste it into the **Vaultwarden
  collection** field on the project detail page (or the Finalize modal). The
  group is then granted access to it. Leave blank to only manage membership.

## Testing off-prod

Like the GitHub/Slack/Gmail finalize steps, this runs **prod-only** because a
non-prod app's tokens point at the same real Vaultwarden org. To exercise it
against a throwaway test org from a non-prod environment, set
`FINALIZE_EXTERNAL_OVERRIDE=1` alongside the four `VAULTWARDEN_*` vars.

## Version note

Vaultwarden tracks the upstream Bitwarden internal API but lags/varies by
version. The HTTP calls live in `app/lib/vaultwarden.ts` (each endpoint
commented); if an endpoint 404s or the body shape is rejected, verify it against
your running server's `/api/docs/`. The sync logic
(`app/projects/lib/vaultwarden-group-sync.ts`) is written against the
`VaultwardenClient` interface, so version drift is contained to the client file.
