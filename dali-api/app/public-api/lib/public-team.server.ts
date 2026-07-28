import { prisma } from "~/lib/db";
import { publicMediaUrl } from "./public-media";

// The public team directory on dali.website.
//
// SECURITY: the User model carries phone numbers, birthdays, ethnicity,
// dietary restrictions, NetIDs, and three email addresses. None of it may
// leave through this endpoint. Two defences, deliberately belt-and-braces:
//
//   1. `USER_PUBLIC_SELECT` below is an explicit allow-list. Never widen it,
//      and never replace it with a spread of a wider select — the Prisma
//      `select` is what actually stops the columns being read at all.
//   2. `publicProfile` gates *which* users appear. It's opt-in (default
//      false), backfilled true for anyone who has been staffed, so a member
//      can be taken off the public site by flipping one boolean.
//
// The response shape matches dali.website's `TeamMember` interface
// (shared/api.ts) exactly, so its components needed no changes.

export type PublicTeamMember = {
  id: string;
  role: string;
  roles: string[];
  hiredRoles: string[];
  name: string;
  year: string;
  majorMinor: string;
  currentRole: string;
  termsInDali: string[];
  coreRoleNames: string[];
  profileImage: string;
  linkedinUrl: string;
};

const USER_PUBLIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  classYear: true,
  major: true,
  photoUrl: true,
  linkedinUrl: true,
  projectAssignments: {
    select: {
      domain: { select: { displayName: true } },
      term: { select: { code: true, sortKey: true } },
    },
  },
  coreAssignments: {
    select: {
      leadTitle: true,
      term: { select: { code: true, sortKey: true } },
    },
  },
} as const;

export async function listPublicTeam(): Promise<PublicTeamMember[]> {
  const users = await prisma.user.findMany({
    where: { publicProfile: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: USER_PUBLIC_SELECT,
  });

  return users.map((u) => {
    // Domains worked, most-recent term first — the site prints the first as
    // the headline role and the rest as secondary badges.
    const byRecency = [...u.projectAssignments].sort(
      (a, b) => b.term.sortKey - a.term.sortKey,
    );
    const roles = [...new Set(byRecency.map((a) => a.domain.displayName))];
    const coreRoleNames = [
      ...new Set(
        u.coreAssignments
          .filter((c) => c.leadTitle)
          .sort((a, b) => b.term.sortKey - a.term.sortKey)
          .map((c) => c.leadTitle as string),
      ),
    ];
    const termsInDali = [
      ...new Set(
        [...u.projectAssignments, ...u.coreAssignments]
          .sort((a, b) => a.term.sortKey - b.term.sortKey)
          .map((a) => a.term.code),
      ),
    ];
    // Core titles outrank a domain when both exist — that's how the lab
    // introduces people, and how the Notion-backed page did it.
    const currentRole = coreRoleNames[0] ?? roles[0] ?? "";

    return {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      role: roles[0] ?? "",
      roles,
      // The old Notion source distinguished "hired for" from "worked as";
      // DALI OS has only the assignment record, so the two collapse.
      hiredRoles: roles,
      year: u.classYear ? String(u.classYear) : "",
      majorMinor: u.major ?? "",
      currentRole,
      termsInDali,
      coreRoleNames,
      profileImage: publicMediaUrl(u.photoUrl) ?? "",
      linkedinUrl: u.linkedinUrl ?? "",
    };
  });
}
