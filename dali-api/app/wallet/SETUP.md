# Wallet pass setup (Apple + Google / Android)

Members add a DALI membership pass to their phone wallet; an organizer scans its
QR at a meeting to mark attendance. The QR carries the same signed token on both
platforms (`app/lib/wallet-token.ts`), so one scanner works for iPhone and
Android alike.

The **code** for both platforms is complete. Turning a platform on is purely a
matter of setting its env vars (secrets). Each "Add to Wallet" button hides until
its platform is configured (`walletAppleConfigured()` / `walletGoogleConfigured()`),
and the scan endpoint 503s until `WALLET_PASS_SECRET` is set.

Env var reference lives in `.env.example` under "Wallet check-in". Set the same
secrets on Fly with `fly secrets set KEY=… --app <app>` for both the staging and
prod apps.

---

## Shared secret (required for either platform)

```
WALLET_PASS_SECRET   # openssl rand -base64 32
```

Global HMAC key mixed into every barcode. Must be set or the whole feature is off.
Keep it stable — rotating it invalidates every pass already on a phone.

---

## Google Wallet (Android) — go-live steps

Android has no `.pkpass`; the pass is a Google Wallet **Generic pass** delivered
via a signed "Save to Google Wallet" link. No Google client library is needed —
we sign the JWT with the service-account key directly (`wallet-google.server.ts`).

1. **Google Cloud project + API.** In the GCP console, enable the **Google Wallet
   API** on the project you'll use.
2. **Service account.** Create a *dedicated* service account (do **not** reuse the
   Workspace-provisioning SA). Generate a JSON key and pull two values from it:
   - `client_email`  → `GOOGLE_WALLET_SA_EMAIL`
   - `private_key`   → `GOOGLE_WALLET_SA_PRIVATE_KEY` (full PEM; `\n` escapes are tolerated)
3. **Issuer account.** In the [Google Pay & Wallet Console](https://pay.google.com/business/console),
   create an issuer, copy its **Issuer ID** → `GOOGLE_WALLET_ISSUER_ID`, and grant
   the service account access to the issuer (Users → add the SA email).
4. **Publishing access.** New issuers start in **demo mode**: only Google accounts
   added under *Wallet API → Publishing → test accounts* can save a pass, and their
   pass shows a "[TEST ONLY]" banner. Add your own test accounts now; request
   production access before rolling out to the lab.
5. **Set the secrets** on staging and prod:
   ```
   fly secrets set \
     GOOGLE_WALLET_ISSUER_ID=… \
     GOOGLE_WALLET_SA_EMAIL=… \
     GOOGLE_WALLET_SA_PRIVATE_KEY="$(cat sa-key.pem)" \
     --app <app>
   ```
6. **Verify.** As a member, open Settings (or your profile) → **Add to Google
   Wallet**. The pass should show the member name, Domain / Class / Member since /
   Core, the navy card, the block-band hero, and a scannable QR.

Notes:
- The pass **class** is created automatically — the save-JWT embeds it inline, so
  there is no separate REST call to make. All design (colors, fields, logo, hero)
  lives on the pass *object*, so redesigns apply on the next save with no console work.
- Google fetches `logo-white.png` and `wallet-hero.png` from the request origin, so
  those assets must be publicly reachable on the deployed host (they ship in `public/`).

---

## Apple Wallet (iPhone) — reference

Already configured via a Pass Type ID cert. Env vars (see `.env.example`):

```
APPLE_PASS_TYPE_ID
APPLE_TEAM_ID
APPLE_PASS_CERT_PEM
APPLE_PASS_KEY_PEM
APPLE_PASS_KEY_PASSPHRASE   # optional
APPLE_WWDR_CERT_PEM
APPLE_PASS_APNS_HOST        # optional; sandbox host for dev
```

The same cert/key double as the APNs credential for silent pass updates
(`wallet-apns.server.ts`).

---

## Pass artwork

The colorful block band on the pass is generated, not hand-drawn. To change it,
edit and re-run `scripts/generate-wallet-pattern.mjs` (uses Playwright, a
devDependency — nothing new ships at runtime), then commit the regenerated
`public/wallet-strip*.png` (Apple strip) and `public/wallet-hero.png` (Google
hero). Keep the band navy (`#0C2C47`) in sync with the pass `backgroundColor` /
`hexBackgroundColor`.
