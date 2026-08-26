import fs from "node:fs";
import path from "node:path";
import { PKPass } from "passkit-generator";
import { prisma } from "~/lib/db";
import { walletTokensConfigured, signWalletToken, ensureWalletSecret } from "~/lib/wallet-token";

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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, createdAt: true },
  });
  if (!user) throw new Error(`User not found: ${userId}`);

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
      backgroundColor: "rgb(0, 83, 164)",
      foregroundColor: "rgb(255,255,255)",
      labelColor: "rgb(220,230,245)",
    },
  );

  // Set pass style to generic (resets any prior field arrays).
  pass.type = "generic";

  // Primary field: member full name.
  pass.primaryFields.push({ key: "member", label: "MEMBER", value: `${user.firstName} ${user.lastName}` });

  // Secondary field: year the member joined.
  const memberSince = String(user.createdAt.getFullYear());
  pass.secondaryFields.push({ key: "memberSince", label: "MEMBER SINCE", value: memberSince });

  // Barcode: signed member token as a QR code.
  const memberSecret = await ensureWalletSecret(userId);
  const token = signWalletToken(userId, memberSecret);
  pass.setBarcodes({ format: "PKBarcodeFormatQR", message: token, messageEncoding: "iso-8859-1" });

  // Images: passkit-generator requires at least icon.png.
  const iconBuf = readBrandAsset("icon-blue.png");
  const logoBuf = readBrandAsset("logo-blue.png");
  pass.addBuffer("icon.png", iconBuf);
  pass.addBuffer("icon@2x.png", iconBuf);
  pass.addBuffer("logo.png", logoBuf);
  pass.addBuffer("logo@2x.png", logoBuf);

  return pass.getAsBuffer();
}
