import { prisma } from "~/lib/db.server";
import {
  toQuestProfile,
  questPercent,
  type QuestProfile,
  type QuestionContext,
} from "~/components/alumni-game/quest";

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
        major: true,
        minors: true,
        funFact: true,
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
    hasWork: workCount > 0,
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

// Records the address the alum wants to be reached at. An address that isn't
// one of the institutional ones also lands in personalEmail so the rest of the
// app (magic links, contact lists) picks it up.
export async function setPreferredEmail(userId: string, email: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { daliEmail: true, dartmouthEmail: true },
  });
  const normalized = email.trim().toLowerCase();
  const institutional = [user.daliEmail, user.dartmouthEmail]
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.toLowerCase());
  await prisma.user.update({
    where: { id: userId },
    data: {
      preferredEmail: normalized,
      ...(institutional.includes(normalized) ? {} : { personalEmail: normalized }),
    },
  });
}

export async function addHistoryNote(userId: string, note: string) {
  const avatar = await prisma.pixelAvatar.findUnique({
    where: { userId },
    select: { historyNote: true },
  });
  const trimmed = note.trim().slice(0, 1000);
  if (trimmed === "") return;
  await prisma.pixelAvatar.updateMany({
    where: { userId },
    data: {
      historyNote: avatar?.historyNote ? `${avatar.historyNote}\n${trimmed}` : trimmed,
    },
  });
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

export async function setOpenTo(
  userId: string,
  openTo: { coffeeChats: boolean; resumeReviews: boolean; portfolioReviews: boolean },
) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      openToCoffeeChats: openTo.coffeeChats,
      openToResumeReviews: openTo.resumeReviews,
      openToPortfolioReviews: openTo.portfolioReviews,
    },
  });
}

// Stamps questCompletedAt the first time the profile reaches 100%. Returns the
// fresh state + percent for the phone UI.
export async function questProgress(userId: string) {
  const { profile, ctx } = await loadQuestState(userId);
  const percent = questPercent(profile);
  if (percent >= 100) {
    await prisma.pixelAvatar.updateMany({
      where: { userId, questCompletedAt: null },
      data: { questCompletedAt: new Date() },
    });
  }
  return { profile, ctx, percent };
}
