/**
 * Queues the one-time alumni invite email (a personal sign-in link) for every
 * alumnus who has not finished onboarding. The outbox drain job sends them.
 *
 * Dry run by default: prints counts and the alumni with no personal email.
 * A user who already has an invite in the batch is skipped, so a re-run only
 * picks up people the last run missed.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/send-alumni-invites.ts --batch 2026-11
 *   npx tsx --env-file .env scripts/send-alumni-invites.ts --batch 2026-11 --send
 *   npx tsx --env-file .env scripts/send-alumni-invites.ts --batch 2026-11 --send --only <userId>,<userId> --limit 20 --template alumni.invite
 */
import { prisma } from "../app/lib/db.server.js";
import { sendLaunchInvite } from "../app/lib/alumni-invite.server.js";
import { parseLaunchArgs, runLaunch } from "./lib/alumni-invite-launch.js";

async function main() {
  await runLaunch(parseLaunchArgs(process.argv.slice(2)), {
    loadCandidates: () =>
      prisma.user.findMany({
        where: { membershipStatus: "Alumni", alumniOnboardedAt: null },
        select: { id: true, firstName: true, email: true, daliEmail: true, personalEmail: true },
        orderBy: { id: "asc" },
      }),
    loadInvitedUserIds: async (batch) =>
      (await prisma.alumniInvite.findMany({ where: { batch }, select: { userId: true } })).map((i) => i.userId),
    send: (target, args) =>
      sendLaunchInvite({ ...target, batch: args.batch, templateKey: args.templateKey }),
    log: console.log,
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
