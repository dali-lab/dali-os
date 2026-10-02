// Partner magic-link timing, client-safe so the sign-in pages and the email can
// all describe the same window.
//
// The TTL used to live only in magic-link.server.ts while three surfaces —
// /partner/login, /partner/auth/verify, and the email itself — each hand-wrote
// "15 minutes". Keeping the number in one place is what stops them drifting apart
// the way the BetterAuth strings did.

import { humanDuration } from "~/email/lib/auth-email";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export const PARTNER_LINK_EXPIRY = humanDuration(MAGIC_LINK_TTL_MS / 1000);
