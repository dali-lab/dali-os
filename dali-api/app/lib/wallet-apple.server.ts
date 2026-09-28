import fs from "node:fs";
import path from "node:path";
import { PKPass } from "passkit-generator";
import { prisma } from "~/lib/db";
import { walletTokensConfigured, signWalletToken, ensureWalletSecret, signWalletAuthToken } from "~/lib/wallet-token";
import { resolveWalletPassFields } from "~/lib/wallet-pass-fields.server";
import { getApiBaseUrl } from "~/lib/app-env";

// Apple Wallet (.pkpass) pass generator for DALI membership passes. Signs passes
// using Apple's passkit-generator (v3) with the three PEM certificates supplied
// via env vars. Gated on walletAppleConfigured() — returns false when any cert
// or the global wallet-token secret is missing, so callers can 503 gracefully.
//
// Cert env vars may arrive with escaped newlines from hosting platforms (Fly.io,
// Vercel, etc.); normalize them before passing to passkit-generator, mirroring
// the pattern in app/lib/google-workspace.ts.

// Brand images for the pass face. In dev they live under public/; the Vite
// build relocates public/ into build/client/ and the deployed image ships
// build/ (not the source public/ dir), so try both roots.
function readBrandAsset(fileName: string): Buffer {
  const candidates = [
    path.join(process.cwd(), "public", fileName),
    path.join(process.cwd(), "build", "client", fileName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  throw new Error(`Wallet pass asset not found: ${fileName}`);
}

/** Whether all env vars required to sign Apple Wallet passes are present. */
export function walletAppleConfigured(): boolean {
  return (
    !!process.env.APPLE_PASS_CERT_PEM &&
    !!process.env.APPLE_PASS_KEY_PEM &&
    !!process.env.APPLE_WWDR_CERT_PEM &&
    !!process.env.APPLE_PASS_TYPE_ID &&
    !!process.env.APPLE_TEAM_ID &&
    walletTokensConfigured()
  );
}

/**
 * Build and return a signed `.pkpass` archive for the given member.
 * Throws if the user is not found or env is misconfigured.
 */
export async function buildAppleWalletPass(userId: string): Promise<Buffer> {
  // Shared with the Google pass so both platforms show the same face.
  const fields = await resolveWalletPassFields(userId); // throws if user not found

  // Baseline the update tag on first download so the web-service
  // "passes updated since" query always has a non-null timestamp to compare.
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletPassUpdatedAt: true },
  });
  if (!existing?.walletPassUpdatedAt) {
    await prisma.user.update({
      where: { id: userId },
      data: { walletPassUpdatedAt: new Date() },
    });
  }

  // Normalize PEM values — hosting platforms often escape newlines as \n literals.
  const signerCert = process.env.APPLE_PASS_CERT_PEM!.replace(/\\n/g, "\n");
  const signerKey = process.env.APPLE_PASS_KEY_PEM!.replace(/\\n/g, "\n");
  const wwdr = process.env.APPLE_WWDR_CERT_PEM!.replace(/\\n/g, "\n");
  const signerKeyPassphrase = process.env.APPLE_PASS_KEY_PASSPHRASE ?? undefined;

  const certificates = { wwdr, signerCert, signerKey, ...(signerKeyPassphrase ? { signerKeyPassphrase } : {}) };

  const pass = new PKPass(
    {},
    certificates,
    {
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
      teamIdentifier: process.env.APPLE_TEAM_ID!,
      organizationName: "DALI Lab",
      description: "DALI Membership",
      serialNumber: userId,
      logoText: "Digital Applied Learning and Innovation Lab",
      // Deep DALI navy (#0C2C47) — matches the block-band strip so it blends
      // into the card face.
      backgroundColor: "rgb(12, 44, 71)",
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(199, 218, 231)",
      // webServiceURL + authenticationToken enable Apple's PassKit web service:
      // when the device sees these, it polls /api/wallet/apple/v1/passes/…
      // after we send an APNs push, so the barcode refreshes silently.
      webServiceURL: `${getApiBaseUrl()}/api/wallet/apple`,
      authenticationToken: signWalletAuthToken(userId),
    },
  );

  // storeCard: membership card with the block-band strip up top and the member
  // name + field grid below (setting the type resets the field arrays).
  pass.type = "storeCard";

  // Primary field: member name, shown prominently over the strip's navy base.
  pass.primaryFields.push({ key: "member", value: fields.name });

  // Field grid mirroring the card design: Domain + Class on the first row
  // (secondary), Member since + Core on the second (auxiliary). Every cell is
  // omitted when we don't have the value, so a partially-onboarded member still
  // gets a valid pass. The values here are staleness-proof (they don't change
  // term to term), so a static pass stays correct.
  if (fields.domainCode) {
    pass.secondaryFields.push({ key: "domain", label: "DOMAIN", value: fields.domainCode });
  }
  if (fields.classYearShort) {
    pass.secondaryFields.push({ key: "class", label: "CLASS", value: fields.classYearShort });
  }
  if (fields.memberSinceTerm) {
    pass.auxiliaryFields.push({ key: "memberSince", label: "MEMBER SINCE", value: fields.memberSinceTerm });
  }
  // Core badge: shown only for Core members, hidden otherwise.
  if (fields.isCore) {
    pass.auxiliaryFields.push({ key: "core", label: "ROLE", value: "Core" });
  }

  // Barcode: signed member token as a QR code.
  const memberSecret = await ensureWalletSecret(userId);
  const token = signWalletToken(userId, memberSecret);
  pass.setBarcodes({ format: "PKBarcodeFormatQR", message: token, messageEncoding: "iso-8859-1" });

  // Images: white icon/logo for the dark card, plus the block-band strip. On
  // storeCard the strip renders below the logo row with the primary field (name)
  // overlaid on its lower-left, so the strip art keeps the block band up top and
  // navy along the bottom for the name to read against (see generate-wallet-pattern.mjs).
  const iconBuf = readBrandAsset("icon-white.png");
  const logoBuf = readBrandAsset("logo-white.png");
  pass.addBuffer("icon.png", iconBuf);
  pass.addBuffer("icon@2x.png", iconBuf);
  pass.addBuffer("logo.png", logoBuf);
  pass.addBuffer("logo@2x.png", logoBuf);
  pass.addBuffer("strip.png", readBrandAsset("wallet-strip.png"));
  pass.addBuffer("strip@2x.png", readBrandAsset("wallet-strip-2x.png"));
  pass.addBuffer("strip@3x.png", readBrandAsset("wallet-strip-3x.png"));

  return pass.getAsBuffer();
}
