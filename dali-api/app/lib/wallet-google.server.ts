// Google Wallet "Generic pass" via a signed save-JWT.
//
// A save-JWT embeds both the class definition and the object definition
// directly in its payload — Google's API accepts an inline class in
// `genericClasses[]` and creates/updates it automatically on the first save.
// This means we never need a separate class-creation REST call, and we need
// zero Google API client libraries: the only credential work is signing the
// JWT RS256 with the service-account private key, which node:crypto handles
// natively.
//
// Flow: build payload → sign RS256 → return
//   https://pay.google.com/gp/v/save/<jwt>
// The user taps that link (or we open it) and Google adds the pass to their
// Wallet app.

import crypto from "node:crypto";
import {
  walletTokensConfigured,
  signWalletToken,
  ensureWalletSecret,
} from "~/lib/wallet-token";
import { resolveWalletPassFields } from "~/lib/wallet-pass-fields.server";

/** base64url-encode a string or Buffer. */
function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

/**
 * Whether Google Wallet pass generation is fully configured.
 * Requires the three Google-specific env vars AND the global wallet signing
 * secret (walletTokensConfigured).
 */
export function walletGoogleConfigured(): boolean {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  const saEmail = process.env.GOOGLE_WALLET_SA_EMAIL;
  const saKey = process.env.GOOGLE_WALLET_SA_PRIVATE_KEY;
  return (
    Boolean(issuerId && issuerId.length > 0) &&
    Boolean(saEmail && saEmail.length > 0) &&
    Boolean(saKey && saKey.length > 0) &&
    walletTokensConfigured()
  );
}

/**
 * Build a `https://pay.google.com/gp/v/save/<JWT>` link for the given member.
 *
 * The JWT encodes a Generic pass with the member's name, DALI branding, and
 * a signed wallet token in the QR barcode. Tapping the link adds (or updates)
 * the pass in Google Wallet without any additional API round-trips.
 */
export async function buildGoogleWalletSaveUrl(
  userId: string,
  origin: string,
): Promise<string> {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID!;
  const saEmail = process.env.GOOGLE_WALLET_SA_EMAIL!;
  // Normalize escaped newlines from env vars (common in .env files and CI secrets).
  const privateKey = process.env.GOOGLE_WALLET_SA_PRIVATE_KEY!.replace(
    /\\n/g,
    "\n",
  );

  const classId = `${issuerId}.dali_membership`;

  // Shared with the Apple pass so both platforms show the same face.
  const fields = await resolveWalletPassFields(userId); // throws if user not found

  const memberSecret = await ensureWalletSecret(userId);
  const barcodeValue = signWalletToken(userId, memberSecret);
  // A save-JWT never updates an object that already exists: Google keeps the
  // first barcode it saw for that id forever. Keying the id to the barcode
  // means a rotated member secret, or a pass first saved from another
  // environment sharing this issuer, gets a fresh object instead of a stale
  // one that fails verification. userId is a cuid and the digest is hex, both
  // safe for Google's ^[a-zA-Z0-9._-]+$ object-id rule.
  const barcodeKey = crypto.createHash("sha256").update(barcodeValue).digest("hex").slice(0, 12);
  const objectId = `${issuerId}.member_${userId}_${barcodeKey}`;

  const genericClass = { id: classId };

  // Field grid mirroring the Apple pass and the card design: Domain, Class,
  // Member since (onboarding term), and a Core badge. Each omitted when unknown;
  // all are staleness-proof (they don't change term to term).
  const textModulesData: Array<{ id: string; header: string; body: string }> = [];
  if (fields.domainCode) {
    textModulesData.push({ id: "domain", header: "Domain", body: fields.domainCode });
  }
  if (fields.classYearShort) {
    textModulesData.push({ id: "class", header: "Class", body: fields.classYearShort });
  }
  if (fields.memberSinceTerm) {
    textModulesData.push({ id: "member_since", header: "Member since", body: fields.memberSinceTerm });
  }
  if (fields.isCore) {
    textModulesData.push({ id: "role", header: "Role", body: "Core" });
  }

  const genericObject = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: {
      defaultValue: { language: "en-US", value: "DALI Lab" },
    },
    header: {
      defaultValue: { language: "en-US", value: fields.name },
    },
    // Deep DALI navy — matches the Apple pass and the hero block band.
    hexBackgroundColor: "#0C2C47",
    logo: { sourceUri: { uri: `${origin}/logo-white.png` } },
    // Colorful DALI block band as the full-width hero banner.
    heroImage: { sourceUri: { uri: `${origin}/wallet-hero.png` } },
    textModulesData,
    barcode: { type: "QR_CODE", value: barcodeValue },
  };

  const claims = {
    iss: saEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [genericClass],
      genericObjects: [genericObject],
    },
  };

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey);
  const signatureB64url = b64url(signature);

  const jwt = `${signingInput}.${signatureB64url}`;
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
