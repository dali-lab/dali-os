import { prisma } from "~/lib/db.server";

let seq = 0;
const next = () => ++seq;

export async function makeUser(first = "Ada", last = "Lovelace") {
  const n = next();
  return prisma.user.create({
    data: {
      firstName: first,
      lastName: last,
      daliEmail: `${first.toLowerCase()}${n}@example.edu`,
    },
  });
}

export async function makeTerm() {
  return prisma.term.upsert({
    where: { code: "26F" },
    update: {},
    create: {
      code: "26F",
      year: 2026,
      season: "F",
      sortKey: 20264,
      startDate: new Date("2026-09-14T00:00:00Z"),
      endDate: new Date("2026-12-01T00:00:00Z"),
    },
  });
}

export async function makeCoreAssignment(userId: string) {
  const term = await makeTerm();
  return prisma.coreAssignment.create({ data: { userId, termId: term.id } });
}

export async function makeMeeting(
  organizerId: string,
  overrides: Partial<Parameters<typeof prisma.scheduledMeeting.create>[0]["data"]> = {},
) {
  return prisma.scheduledMeeting.create({
    data: {
      organizerId,
      title: "Weekly sync",
      durationMinutes: 60,
      scopeType: "UserList",
      participantUserIds: [],
      ownerCalendarEmail: "ada@example.edu",
      status: "Confirmed",
      ...overrides,
    } as Parameters<typeof prisma.scheduledMeeting.create>[0]["data"],
  });
}

export async function makeCalendarLink(userId: string, subCalendarIds: string[] = [], externalEmail = "ada@example.edu") {
  return prisma.userCalendarLink.create({
    data: { userId, provider: "Google", externalEmail, oauthTokens: "enc", subCalendarIds },
  });
}
