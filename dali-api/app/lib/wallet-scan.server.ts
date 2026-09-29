import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { classifyWalletScanFailure, memberIdFromToken, verifyWalletToken } from "~/lib/wallet-token";

export type ScannedMember = {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  isDaliMember: boolean;
};

/**
 * Resolve a scanned wallet-pass token to its member, verified against that
 * member's CURRENT secret so a revoked pass stops working. Returns null on any
 * failure (logging which cause, never the token) so callers can answer with one
 * generic message that doesn't leak member existence.
 */
export async function resolveScannedMember(token: string, context: string): Promise<ScannedMember | null> {
  const scannedId = memberIdFromToken(token);
  const scanned = scannedId
    ? await prisma.user.findUnique({
        where: { id: scannedId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          daliEmail: true,
          walletPassSecret: true,
        },
      })
    : null;
  if (!scanned || !verifyWalletToken(token, scanned.walletPassSecret).ok) {
    console.error(
      `${context}: rejected pass (member=${scannedId ?? "?"}, reason=${classifyWalletScanFailure(token, scanned)})`,
    );
    return null;
  }
  return {
    id: scanned.id,
    firstName: scanned.firstName,
    lastName: scanned.lastName,
    photoUrl: await resolvePhotoUrl(scanned.photoUrl),
    isDaliMember: !!scanned.daliEmail,
  };
}
