import { prisma } from "~/lib/db.server";
import { chooseContactEmail } from "~/members/lib/contact-email.server";
import { normalizeEmailAddress } from "~/lib/user-email.server";
import {
  toQuestProfile,
  questPercent,
  type QuestProfile,
  type QuestionContext,
} from "~/alumni/lib/quest";

export type QuestState = { profile: QuestProfile; ctx: QuestionContext };

export async function loadQuestState(userId: string): Promise<QuestState> {
  const [user, avatar, workCount, historyLines] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        preferredEmail: true,
        classYear: true,
        currentLocation: true,
        hometown: true,
        birthday: true,
        majors: true,
        minors: true,
        askMeAbout: true,
        funFact: true,
        outsideOfWork: true,
        dietaryRestrictions: true,
        linkedinUrl: true,
        personalSite: true,
      },
    }),
    prisma.pixelAvatar.findUnique({
      where: { userId },
      select: { confirmedFields: true },
    }),
    prisma.workExperience.count({ where: { userId } }),
    loadDaliHistoryLines(userId),
  ]);
  const confirmed = avatar?.confirmedFields ?? [];
  const profile = toQuestProfile({
    user: {
      ...user,
      birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : null,
    },
    confirmed,
    workCount,
  });
  const ctx: QuestionContext = {
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    emails: [user.personalEmail, user.daliEmail, user.dartmouthEmail].filter(
      (e): e is string => typeof e === "string" && e !== "",
    ),
    historyLines,
  };
  return { profile, ctx };
}

export async function loadDaliHistoryLines(userId: string): Promise<string[]> {
  const [assignments, coreRows, leadRows] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { userId },
      select: {
        level: true,
        project: { select: { name: true } },
        domain: { select: { name: true } },
        term: { select: { code: true, sortKey: true } },
      },
    }),
    prisma.coreAssignment.findMany({
      where: { userId },
      select: { leadTitle: true, term: { select: { code: true, sortKey: true } } },
    }),
    prisma.domainLeadAssignment.findMany({
      where: { userId },
      select: {
        domain: { select: { displayName: true } },
        term: { select: { code: true, sortKey: true } },
      },
    }),
  ]);
  const rows = [
    ...assignments.map((a) => ({
      sortKey: a.term.sortKey,
      line: `${a.term.code}: ${a.project.name} (${a.domain.name} ${a.level})`,
    })),
    ...coreRows.map((c) => ({
      sortKey: c.term.sortKey,
      line: `${c.term.code}: ${c.leadTitle ? `Core, ${c.leadTitle}` : "Core"}`,
    })),
    ...leadRows.map((d) => ({
      sortKey: d.term.sortKey,
      line: `${d.term.code}: ${d.domain.displayName} Lead`,
    })),
  ];
  return rows.sort((a, b) => a.sortKey - b.sortKey).map((r) => r.line);
}

export async function loadQuestProfile(userId: string): Promise<QuestProfile> {
  return (await loadQuestState(userId)).profile;
}

export async function confirmQuestField(userId: string, key: string) {
  await prisma.pixelAvatar.updateMany({
    where: { userId, NOT: { confirmedFields: { has: key } } },
    data: { confirmedFields: { push: key } },
  });
}

export type PreferredEmailOutcome = "saved" | "code_sent";

export async function setPreferredEmail(userId: string, email: string, request?: Request): Promise<PreferredEmailOutcome> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { daliEmail: true, dartmouthEmail: true },
  });
  const normalized = normalizeEmailAddress(email);
  const own = [user.daliEmail, user.dartmouthEmail].filter((e): e is string => typeof e === "string").map(normalizeEmailAddress);
  if (!own.includes(normalized)) {
    const { status } = await chooseContactEmail({ userId, address: normalized, request });
    if (status === "code_sent") return "code_sent";
  }
  await prisma.user.update({ where: { id: userId }, data: { preferredEmail: normalized } });
  return "saved";
}

export async function addQuestWorkExperience(
  userId: string,
  company: string,
  position: string,
) {
  const now = new Date();
  await prisma.workExperience.create({
    data: {
      userId,
      company,
      position,
      startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    },
  });
}

export async function markAlumniOnboarded(userId: string, at = new Date()) {
  await prisma.user.updateMany({
    where: { id: userId, alumniOnboardedAt: null },
    data: { alumniOnboardedAt: at },
  });
}

// Stamps questCompletedAt the first time the profile reaches 100%, and marks
// alumni onboarding done so the first-login invite stops showing.
export async function questProgress(userId: string) {
  const { profile, ctx } = await loadQuestState(userId);
  const percent = questPercent(profile);
  if (percent >= 100) {
    const now = new Date();
    await Promise.all([
      prisma.pixelAvatar.updateMany({
        where: { userId, questCompletedAt: null },
        data: { questCompletedAt: now },
      }),
      markAlumniOnboarded(userId, now),
    ]);
  }
  return { profile, ctx, percent };
}
