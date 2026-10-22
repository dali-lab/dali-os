import type { Route } from "./+types/api.mobile.pass";
import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolveWalletPassFields } from "~/lib/wallet-pass-fields.server";
import { ensureWalletSecret, signWalletToken, walletTokensConfigured } from "~/lib/wallet-token";
import { checkInLocation, formatPassDate, passAccessLevel, passDisplayId } from "~/lib/mobile-format";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;
  if (!walletTokensConfigured()) return mobileError("Member passes aren't set up on this server", 503);

  const [fields, secret, term, attendance] = await Promise.all([
    resolveWalletPassFields(userId),
    ensureWalletSecret(userId),
    currentTerm(request),
    prisma.meetingAttendance.findMany({
      where: { userId, present: true },
      orderBy: [{ markedAt: "desc" }, { occurrenceStart: "desc" }],
      take: 20,
      select: {
        id: true,
        markedAt: true,
        occurrenceStart: true,
        meeting: { select: { title: true, location: true, rooms: { select: { name: true } } } },
      },
    }),
  ]);

  return mobileJson({
    passId: passDisplayId(userId, fields.memberSinceTerm),
    qrPayload: signWalletToken(userId, secret),
    name: fields.name,
    memberSince: fields.memberSinceTerm,
    accessLevel: passAccessLevel(fields),
    validThrough: term ? formatPassDate(term.endDate) : null,
    checkIns: attendance.map((a) => ({
      id: a.id,
      location: checkInLocation(a.meeting),
      at: (a.markedAt ?? a.occurrenceStart).toISOString(),
    })),
  });
}
