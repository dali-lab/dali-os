import { prisma } from "~/lib/db";

/**
 * links a Google OAuthed user (DALI login) to a CAS identity (Dartmouth login).
 *
 * covers three cases:
 * 1. a separate CAS user already exists → merge Google user into CAS user (absorb daliEmail)
 * 2. CAS user exists and is the same record → no-op
 * 3. no CAS user exists → attach netId to the Google user
 */
export async function linkCasToGoogleUser(googleUserId: string, netId: string) {
  const googleUser = await prisma.user.findUnique({
    where: { id: googleUserId },
  });
  if (!googleUser) throw new Error("Google user not found");

  const casUser = await prisma.user.findUnique({ where: { netId } });

  if (casUser && casUser.id !== googleUser.id) {
    // merge: separate CAS user exists — absorb Google user into CAS user
    return prisma.$transaction(async (tx) => {
      const daliEmail = googleUser.daliEmail;

      // migrate refresh tokens to the surviving user
      await tx.refreshToken.updateMany({
        where: { userId: googleUser.id },
        data: { userId: casUser.id },
      });

      // migrate OAuth sessions to the surviving user
      await tx.oAuthSession.updateMany({
        where: { userId: googleUser.id },
        data: { userId: casUser.id },
      });

      await tx.user.delete({ where: { id: googleUser.id } });
      return tx.user.update({
        where: { id: casUser.id },
        data: { daliEmail },
      });
    });
  }

  if (casUser && casUser.id === googleUser.id) {
    return casUser;
  }

  // no CAS user — attach netId to Google user
  return prisma.user.update({
    where: { id: googleUser.id },
    data: { netId },
  });
}
