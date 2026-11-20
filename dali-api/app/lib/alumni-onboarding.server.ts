import { prisma } from "~/lib/db.server";
import { BadRequestError } from "~/lib/http-error";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { addQuestWorkExperience, markAlumniOnboarded } from "~/lib/alumni-game.server";
import { updateProfileFields } from "~/members/lib/profile-update.server";
import {
  blockIdFor,
  classTag,
  joinRoles,
  pluralize,
  splitWork,
  summarizeDali,
  type AlumniInvite,
  type OpenToChoices,
} from "~/lib/alumni-onboarding";

export async function alumniInviteFor(userId: string, isAlumni: boolean): Promise<AlumniInvite | null> {
  if (!isAlumni) return null;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { alumniOnboardedAt: true },
  });
  if (!row || row.alumniOnboardedAt !== null) return null;
  return "choice";
}

export type WorkSlot = { id: string; position: string; company: string; location: string | null; year: number | null };

export type OnboardingData = {
  firstName: string;
  fullName: string;
  classYear: number | null;
  majors: string[];
  minors: string[];
  hometown: string | null;
  basedIn: {
    currentLocation: string | null;
    currentLocationGeonameId: number | null;
    currentLocationLat: number | null;
    currentLocationCity: string | null;
    currentLocationRegion: string | null;
    currentLocationCountry: string | null;
  };
  linkedinUrl: string;
  personalSite: string;
  birthday: string;
  dietaryRestrictions: string;
  dali: { projectCount: number; termCount: number; projectNames: string[]; rolesLine: string };
  now: WorkSlot | null;
  before: WorkSlot | null;
  funFact: string;
  outsideOfWork: string;
  askMeAbout: string[];
  openTo: OpenToChoices;
  photoUrl: string | null;
  blockId: string;
  nameTag: { name: string; subtitle: string | null };
  worthALook: { connect: { title: string; detail: string }; peers: { detail: string } };
};

function toSlot(
  row: { id: string; company: string; position: string; location: string | null; endDate: Date | null } | null,
): WorkSlot | null {
  if (!row) return null;
  return {
    id: row.id,
    position: row.position,
    company: row.company,
    location: row.location,
    year: row.endDate ? row.endDate.getUTCFullYear() : null,
  };
}

export async function loadOnboarding(userId: string): Promise<OnboardingData> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      classYear: true,
      majors: true,
      minors: true,
      hometown: true,
      currentLocation: true,
      currentLocationGeonameId: true,
      currentLocationLat: true,
      currentLocationCity: true,
      currentLocationRegion: true,
      currentLocationCountry: true,
      linkedinUrl: true,
      personalSite: true,
      birthday: true,
      dietaryRestrictions: true,
      photoUrl: true,
      funFact: true,
      outsideOfWork: true,
      askMeAbout: true,
      openToCoffeeChats: true,
      openToResumeReviews: true,
      openToPortfolioReviews: true,
      openToPartnerReferrals: true,
      openToMentoring: true,
      openToSpeaking: true,
      workExperiences: {
        orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }],
        select: { id: true, company: true, position: true, location: true, endDate: true },
      },
      projectAssignments: {
        select: {
          project: { select: { id: true, name: true } },
          term: { select: { id: true, sortKey: true } },
          domain: { select: { displayName: true } },
        },
      },
    },
  });

  const dali = summarizeDali(user.projectAssignments);
  const { now, before } = splitWork(user.workExperiences);
  const projectIds = [...new Set(user.projectAssignments.map((a) => a.project.id))];
  const city = user.currentLocationCity;

  const [photoUrl, nearby, peers] = await Promise.all([
    resolvePhotoUrl(user.photoUrl),
    city
      ? prisma.user.count({ where: { ...LAB_MEMBER_WHERE, id: { not: userId }, currentLocationCity: city } })
      : Promise.resolve(0),
    projectIds.length > 0
      ? prisma.user.count({
          where: {
            ...LAB_MEMBER_WHERE,
            id: { not: userId },
            projectAssignments: { some: { projectId: { in: projectIds } } },
          },
        })
      : Promise.resolve(0),
  ]);

  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const nowSlot = toSlot(now);

  return {
    firstName: user.firstName,
    fullName,
    classYear: user.classYear,
    majors: user.majors,
    minors: user.minors,
    hometown: user.hometown,
    basedIn: {
      currentLocation: user.currentLocation,
      currentLocationGeonameId: user.currentLocationGeonameId,
      currentLocationLat: user.currentLocationLat,
      currentLocationCity: user.currentLocationCity,
      currentLocationRegion: user.currentLocationRegion,
      currentLocationCountry: user.currentLocationCountry,
    },
    linkedinUrl: user.linkedinUrl ?? "",
    personalSite: user.personalSite ?? "",
    birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : "",
    dietaryRestrictions: user.dietaryRestrictions ?? "",
    dali: {
      projectCount: dali.projectCount,
      termCount: dali.termCount,
      projectNames: dali.projectNames.slice(0, 3),
      rolesLine: joinRoles(dali.roles),
    },
    now: nowSlot,
    before: toSlot(before),
    funFact: user.funFact ?? "",
    outsideOfWork: user.outsideOfWork ?? "",
    askMeAbout: user.askMeAbout,
    openTo: {
      coffeeChats: user.openToCoffeeChats,
      resumeReviews: user.openToResumeReviews || user.openToPortfolioReviews,
      partnerReferrals: user.openToPartnerReferrals,
      mentoring: user.openToMentoring,
      speaking: user.openToSpeaking,
    },
    photoUrl,
    blockId: blockIdFor(userId),
    nameTag: {
      name: classTag(fullName, user.classYear),
      subtitle: nowSlot ? `${nowSlot.position}, ${nowSlot.company}` : null,
    },
    worthALook: {
      connect: {
        title: city ? `Alumni in ${city}` : "Alumni near you",
        detail:
          nearby > 0
            ? `${nearby} nearby on Connect`
            : "See who is around on Connect",
      },
      peers: {
        detail:
          peers > 0 && dali.projectNames[0]
            ? `${pluralize(peers, "person", "people")} who also worked on ${dali.projectNames[0]}`
            : "Find people who worked on the same projects",
      },
    },
  };
}

export function openToPatch(choices: OpenToChoices) {
  return {
    coffeeChats: choices.coffeeChats,
    resumeReviews: choices.resumeReviews,
    portfolioReviews: choices.resumeReviews,
    partnerReferrals: choices.partnerReferrals,
    mentoring: choices.mentoring,
    speaking: choices.speaking,
  };
}

export async function finishOnboarding(userId: string, choices: OpenToChoices) {
  await updateProfileFields(userId, { openTo: openToPatch(choices) }, { allowNetId: false });
  await markAlumniOnboarded(userId);
}

export async function saveAbout(
  userId: string,
  about: {
    funFact: string;
    outsideOfWork: string;
    askMeAbout: string[];
    linkedinUrl?: string;
    personalSite?: string;
    birthday?: string;
    dietaryRestrictions?: string;
  },
) {
  await updateProfileFields(userId, about, { allowNetId: false });
}

export async function saveStudy(
  userId: string,
  input: { classYear: string; majors: string[]; minors: string[] },
) {
  await updateProfileFields(userId, input, { allowNetId: false });
}

export async function saveBasedIn(
  userId: string,
  input: { currentLocation: string; currentLocationGeonameId: string },
) {
  await updateProfileFields(userId, input, { allowNetId: false });
}


export async function saveHometown(userId: string, hometown: string) {
  await updateProfileFields(userId, { hometown }, { allowNetId: false });
}

const MAX_WORK_TEXT = 120;

export async function saveWorkSlot(
  userId: string,
  input: { slot: "now" | "before"; id: string; position: string; company: string; year: string },
) {
  const position = input.position.trim();
  const company = input.company.trim();
  if (!position || !company) throw new BadRequestError("Add a role and a company.");
  if (position.length > MAX_WORK_TEXT || company.length > MAX_WORK_TEXT) {
    throw new BadRequestError("Keep the role and company under 120 characters.");
  }

  let year: number | null = null;
  if (input.slot === "before" && input.year.trim() !== "") {
    year = Number(input.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new BadRequestError("Year must be four digits.");
    }
  }

  if (input.slot === "now") {
    if (input.id) {
      await prisma.workExperience.updateMany({
        where: { id: input.id, userId, endDate: null },
        data: { position, company },
      });
    } else {
      await addQuestWorkExperience(userId, company, position);
    }
    return;
  }

  if (!input.id) {
    if (year === null) throw new BadRequestError("Add the year you left.");
    const date = new Date(Date.UTC(year, 0, 1));
    await prisma.workExperience.create({
      data: { userId, company, position, startDate: date, endDate: date },
    });
    return;
  }

  const existing = await prisma.workExperience.findFirst({
    where: { id: input.id, userId },
    select: { startDate: true, endDate: true },
  });
  if (!existing) throw new BadRequestError("That job isn't on your profile.");
  const data: { position: string; company: string; startDate?: Date; endDate?: Date } = { position, company };
  if (year !== null) {
    const end = new Date(Date.UTC(year, (existing.endDate ?? existing.startDate).getUTCMonth(), 1));
    data.endDate = end;
    if (existing.startDate > end) data.startDate = end;
  }
  await prisma.workExperience.updateMany({ where: { id: input.id, userId }, data });
}
