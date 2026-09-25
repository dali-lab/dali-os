import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";

// Browser-only BetterAuth client. Everything else in the app talks to BetterAuth
// server-side via `auth.api.*`; this exists solely for the passkey (WebAuthn)
// ceremonies, which the browser must run itself — `navigator.credentials` has no
// server equivalent.
//
// No `baseURL`: requests go to the same-origin relative `/api/auth/*`, which is
// where the handler is mounted (routes/api.auth.$.ts). Constructing the client
// touches no browser APIs, so importing this module is SSR-safe; only the action
// calls (in event handlers / effects) run WebAuthn, and those are client-only.
export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});
