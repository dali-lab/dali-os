import { prisma } from "~/lib/db.server";
import {
  toQuestProfile,
  questPercent,
  type QuestProfile,
  type QuestionContext,
} from "~/components/alumni-game/quest";

export type QuestState = { profile: QuestProfile; ctx: QuestionContext };

export async function loadQuestState(userId: string): Promise<QuestState> {
  const [user, avatar, workCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        classYear: true,
        currentLocation: true,
        hometown: true,
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
  ]);
  const confirmed = avatar?.confirmedFields ?? [];
  const profile = toQuestProfile({ user, confirmed, hasWork: workCount > 0 });
  const ctx: QuestionContext = {
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    emails: [user.personalEmail, user.daliEmail, user.dartmouthEmail].filter(
      (e): e is string => typeof e === "string" && e !== "",
    ),
  };
  return { profile, ctx };
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
