import { prisma } from "~/lib/db.server";
import { userTextWhere } from "~/lib/person-search";
import { listVisibleGroupsForUser } from "~/lib/groups.server";
import type { SharePermission, LinkAccess } from "~/generated/prisma/client";

const PERMISSIONS: readonly string[] = ["View", "Comment", "Edit", "FullAccess"];
export function parsePermission(v: string | undefined, fallback: SharePermission = "View"): SharePermission {
  return v && PERMISSIONS.includes(v) ? (v as SharePermission) : fallback;
}

const LINK_ACCESSES: readonly string[] = ["Restricted", "LabMembers", "SignedIn", "Partners", "Public"];
export function parseLinkAccess(v: string | undefined): LinkAccess {
  return v && LINK_ACCESSES.includes(v) ? (v as LinkAccess) : "Restricted";
}

/** Name-scoped, capped directory lookup for the Share dialog's picker; never lists the member table. */
export async function loadShareOptions(me: string, q: string) {
  const [members, groups] = await Promise.all([
    q.length < 2
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: {
            id: { not: me },
            daliMember: { isNot: null },
            ...userTextWhere(q, ["firstName", "lastName"]),
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 8,
          select: { id: true, firstName: true, lastName: true },
        }),
    listVisibleGroupsForUser(me),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, label: `${m.firstName} ${m.lastName}`.trim() })),
    groups: groups.map((g) => ({ id: g.id, label: g.name })),
  };
}
