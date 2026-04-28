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

      // re-point DALIMember to the surviving CAS user
      await tx.dALIMember.updateMany({
        where: { userId: googleUser.id },
        data: { userId: casUser.id },
      });

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

/**
 * Checks if a CAS user corresponds to an existing DALI member and merges
 * accounts if needed. Called from the cookie-based CAS callback.
 *
 * Returns the DALIMember if the user is a member (after any merge), or null.
 */
export async function linkCasUserToMember(casUserId: string, dartmouthEmail: string) {
  // Check if a DALIMember exists with this dartmouthEmail
  const member = await prisma.dALIMember.findFirst({
    where: { dartmouthEmail },
    select: { id: true, userId: true },
  });

  if (!member) return null;

  if (member.userId && member.userId !== casUserId) {
    // DALIMember is linked to a different User (created via Google login).
    // Merge: keep CAS user (has netId), absorb the Google user.
    const googleUserId = member.userId;
    const googleUser = await prisma.user.findUnique({
      where: { id: googleUserId },
      select: { daliEmail: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.dALIMember.update({
        where: { id: member.id },
        data: { userId: casUserId },
      });

      await tx.refreshToken.updateMany({
        where: { userId: googleUserId },
        data: { userId: casUserId },
      });

      await tx.oAuthSession.updateMany({
        where: { userId: googleUserId },
        data: { userId: casUserId },
      });

      await tx.user.delete({ where: { id: googleUserId } });

      if (googleUser?.daliEmail) {
        await tx.user.update({
          where: { id: casUserId },
          data: { daliEmail: googleUser.daliEmail },
        });
      }
    });
  } else if (!member.userId) {
    // DALIMember exists but no User linked yet — link it
    await prisma.dALIMember.update({
      where: { id: member.id },
      data: { userId: casUserId },
    });
  }

  return member;
}
