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
import { prisma } from "~/lib/db";
import {
  walletTokensConfigured,
  signWalletToken,
  ensureWalletSecret,
} from "~/lib/wallet-token";

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
  // userId is a cuid — alphanumeric characters only, safe for Google's
  // ^[a-zA-Z0-9._-]+$ object-id rule.
  const objectId = `${issuerId}.member_${userId}`;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      classYear: true,
      daliMember: { select: { onboardedAt: true } },
    },
  });
  if (!user) throw new Error(`User not found: ${userId}`);

  const memberSecret = await ensureWalletSecret(userId);
  const barcodeValue = signWalletToken(userId, memberSecret);

  const genericClass = { id: classId };

  // Onboarding-based "member since" + class year, mirroring the Apple pass.
  // Each omitted when unknown; both are staleness-proof.
  const textModulesData: Array<{ id: string; header: string; body: string }> = [];
  if (user.daliMember?.onboardedAt) {
    textModulesData.push({
      id: "member_since",
      header: "Member since",
      body: String(user.daliMember.onboardedAt.getFullYear()),
    });
  }
  if (user.classYear) {
    textModulesData.push({ id: "class", header: "Class", body: `'${String(user.classYear).slice(-2)}` });
  }

  const genericObject = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: {
      defaultValue: { language: "en-US", value: "DALI Lab" },
    },
    header: {
      defaultValue: {
        language: "en-US",
        value: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      },
    },
    subheader: {
      defaultValue: { language: "en-US", value: "Membership" },
    },
    hexBackgroundColor: "#1E5779",
    logo: { sourceUri: { uri: `${origin}/logo-white.png` } },
    heroImage: { sourceUri: { uri: `${origin}/wallet/hero.png` } },
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
