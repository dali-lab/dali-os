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
    // merge: separate CAS user exists — absorb Google user into CAS user.
    // This branch only runs in the freshly-chained login flow, where the
    // Google user was just created by upsertUserFromGoogle moments earlier
    // and has no accumulated data beyond Session + OAuthSession + DALIMember.
    // The backfill script handles the harder case of older duplicates.
    return prisma.$transaction(async (tx) => {
      const daliEmail = googleUser.daliEmail;

      await tx.session.updateMany({
        where: { userId: googleUser.id },
        data: { userId: casUser.id },
      });

      await tx.oAuthSession.updateMany({
        where: { userId: googleUser.id },
        data: { userId: casUser.id },
      });

      // upsertUserFromGoogle always creates a DALIMember marker on the new
      // user; the CAS-side applicant has none. Re-parent unless the CAS user
      // somehow already has one (paranoia — shouldn't happen pre-acceptance).
      const existingMember = await tx.dALIMember.findUnique({
        where: { userId: casUser.id },
        select: { id: true },
      });
      if (existingMember) {
        await tx.dALIMember.deleteMany({ where: { userId: googleUser.id } });
      } else {
        await tx.dALIMember.updateMany({
          where: { userId: googleUser.id },
          data: { userId: casUser.id },
        });
      }

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
