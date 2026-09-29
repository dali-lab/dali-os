// Google Wallet "Generic pass".
//
// Two paths, both off the same service-account credential:
//
//  - Save (new pass): a save-JWT embeds the class + object inline in its payload;
//    Google creates them on first save. Signed RS256 with node:crypto — no client
//    library needed. Flow: build payload → sign → return
//    https://pay.google.com/gp/v/save/<jwt>, which the user taps to add the pass.
//
//  - Patch (already-saved pass): a save-JWT never *updates* an object Google has
//    already stored, so restyling installed passes needs the Wallet REST API. We
//    mint an OAuth token from the same SA (google-auth-library) and PATCH each
//    existing object in place; Google pushes the refreshed design to phones. See
//    patchAllGoogleWalletObjects (invoked by scripts/wallet-broadcast-restyle.ts).

import crypto from "node:crypto";
import { JWT } from "google-auth-library";
import {
  walletTokensConfigured,
  signWalletToken,
  ensureWalletSecret,
} from "~/lib/wallet-token";
import { resolveWalletPassFields } from "~/lib/wallet-pass-fields.server";

// Google Wallet REST API base + the object-issuer scope the SA needs.
const WALLET_API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

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

type GenericObject = {
  id: string;
  classId: string;
  state: string;
  cardTitle: { defaultValue: { language: string; value: string } };
  header: { defaultValue: { language: string; value: string } };
  hexBackgroundColor: string;
  logo: { sourceUri: { uri: string } };
  heroImage: { sourceUri: { uri: string } };
  textModulesData: Array<{ id: string; header: string; body: string }>;
  barcode: { type: string; value: string };
};

/**
 * Build the Generic pass object for a member — the single source of truth for the
 * pass face, shared by the save-JWT (new pass) and the REST patch (restyle).
 *
 * The object id defaults to a barcode-keyed id so a *new* object gets a fresh id
 * whenever the barcode changes (rotated secret / cross-environment save). Pass an
 * `existingObjectId` to rebuild the SAME object for an in-place PATCH; the barcode
 * is refreshed to the member's current token, so the patch also self-heals a pass
 * whose secret rotated since it was saved.
 */
async function buildMemberGenericObject(
  userId: string,
  origin: string,
  existingObjectId?: string,
): Promise<{ classId: string; objectId: string; genericObject: GenericObject }> {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID!;
  const classId = `${issuerId}.dali_membership`;

  // Shared with the Apple pass so both platforms show the same face.
  const fields = await resolveWalletPassFields(userId); // throws if user not found

  const memberSecret = await ensureWalletSecret(userId);
  const barcodeValue = signWalletToken(userId, memberSecret);
  // userId is a cuid and the digest is hex, both safe for Google's
  // ^[a-zA-Z0-9._-]+$ object-id rule.
  const barcodeKey = crypto.createHash("sha256").update(barcodeValue).digest("hex").slice(0, 12);
  const objectId = existingObjectId ?? `${issuerId}.member_${userId}_${barcodeKey}`;

  // Field grid mirroring the Apple pass and the card design: Domain, Class,
  // Member since (onboarding term), and a Core badge. Each omitted when unknown;
  // all are staleness-proof (they don't change term to term).
  const textModulesData: GenericObject["textModulesData"] = [];
  if (fields.domainCode) textModulesData.push({ id: "domain", header: "Domain", body: fields.domainCode });
  if (fields.classYearShort) textModulesData.push({ id: "class", header: "Class", body: fields.classYearShort });
  if (fields.memberSinceTerm) textModulesData.push({ id: "member_since", header: "Member since", body: fields.memberSinceTerm });
  if (fields.isCore) textModulesData.push({ id: "role", header: "Role", body: "Core" });

  const genericObject: GenericObject = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: { defaultValue: { language: "en-US", value: "DALI Lab" } },
    header: { defaultValue: { language: "en-US", value: fields.name } },
    // Deep DALI navy — matches the Apple pass and the hero block band.
    hexBackgroundColor: "#0C2C47",
    logo: { sourceUri: { uri: `${origin}/logo-white.png` } },
    // Colorful DALI block band as the full-width hero banner.
    heroImage: { sourceUri: { uri: `${origin}/wallet-hero.png` } },
    textModulesData,
    barcode: { type: "QR_CODE", value: barcodeValue },
  };

  return { classId, objectId, genericObject };
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
  const saEmail = process.env.GOOGLE_WALLET_SA_EMAIL!;
  // Normalize escaped newlines from env vars (common in .env files and CI secrets).
  const privateKey = process.env.GOOGLE_WALLET_SA_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const { classId, genericObject } = await buildMemberGenericObject(userId, origin);

  const claims = {
    iss: saEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [{ id: classId }],
      genericObjects: [genericObject],
    },
  };

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);

  return `https://pay.google.com/gp/v/save/${signingInput}.${b64url(signature)}`;
}

/** Mint a short-lived OAuth token for the Wallet REST API from the SA key. */
async function getWalletAccessToken(): Promise<string> {
  const jwt = new JWT({
    email: process.env.GOOGLE_WALLET_SA_EMAIL!,
    key: process.env.GOOGLE_WALLET_SA_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: [WALLET_SCOPE],
  });
  const { access_token } = await jwt.authorize();
  if (!access_token) throw new Error("No access token from Google Wallet service account.");
  return access_token;
}

/** The member userId encoded in an object id (`…member_<userId>_<barcodeKey>`), or null. */
export function userIdFromGoogleObjectId(objectId: string, issuerId: string): string | null {
  const prefix = `${issuerId}.member_`;
  if (!objectId.startsWith(prefix)) return null;
  const rest = objectId.slice(prefix.length);
  const cut = rest.lastIndexOf("_");
  if (cut <= 0) return null;
  return rest.slice(0, cut);
}

export type GoogleWalletPatchResult = {
  total: number;
  patched: number;
  failed: number;
  skipped: number;
};

/**
 * PATCH every existing Google Wallet object under our class with the current
 * design (and current barcode). This is the release step that restyles passes
 * already saved on members' phones — Google pushes the refreshed object to
 * devices automatically. A save-JWT can't do this (it never updates an existing
 * object), so we go through the REST API here.
 *
 * `commit=false` lists and counts without writing (dry run). Per-object failures
 * (deleted member, transient error) are logged and counted, never thrown, so one
 * bad object can't abort the whole release.
 */
export async function patchAllGoogleWalletObjects(
  origin: string,
  commit: boolean,
): Promise<GoogleWalletPatchResult> {
  if (!walletGoogleConfigured()) throw new Error("Google Wallet is not configured.");

  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID!;
  const classId = `${issuerId}.dali_membership`;
  const token = await getWalletAccessToken();

  const result: GoogleWalletPatchResult = { total: 0, patched: 0, failed: 0, skipped: 0 };

  let pageToken: string | undefined;
  do {
    const url = new URL(`${WALLET_API_BASE}/genericObject`);
    url.searchParams.set("classId", classId);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("token", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Wallet object list failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      resources?: Array<{ id: string }>;
      pagination?: { nextPageToken?: string };
    };

    for (const obj of body.resources ?? []) {
      result.total++;
      const userId = userIdFromGoogleObjectId(obj.id, issuerId);
      if (!userId) {
        result.skipped++;
        continue;
      }
      try {
        const { genericObject } = await buildMemberGenericObject(userId, origin, obj.id);
        if (commit) {
          const patchRes = await fetch(
            `${WALLET_API_BASE}/genericObject/${encodeURIComponent(obj.id)}`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify(genericObject),
            },
          );
          if (!patchRes.ok) throw new Error(`${patchRes.status} ${await patchRes.text()}`);
        }
        result.patched++;
      } catch (err) {
        result.failed++;
        console.warn(
          `[wallet-google] patch failed for ${obj.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    pageToken = body.pagination?.nextPageToken;
  } while (pageToken);

  return result;
}
