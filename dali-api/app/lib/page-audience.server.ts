// "Who can see this", summarised per page for the Drive. Display only: nothing
// here authorises anything, and the rules mirror (not replace) getPageAccess.
//
// Viewer-safe: names and photos are resolved only for pages the caller says the
// viewer can manage sharing on. Everyone else gets kind, label and a count.
// Group member lists are never resolved here; the Share dialog does that.

import { prisma } from "~/lib/db.server";
import { findGoverningScopeFor, governingScopeMap, type AncestorRow } from "~/lib/pageAccess.server";
import { PERMISSION_RANK } from "~/lib/page-sharing.server";
import { resolveGroupMembers } from "~/lib/groups";
import type { SharePermission } from "~/generated/prisma/client";
import type { Audience, AudiencePermission, AudiencePerson, InheritedScope } from "~/lib/page-audience";

export type {
  Audience,
  AudienceKind,
  AudiencePermission,
  AudiencePerson,
  InheritedScope,
} from "~/lib/page-audience";

export interface AudiencePageRow {
  id: string;
  title?: string;
  parentPageId: string | null;
  workspaceType: string;
  createdById: string | null;
  linkAccess?: string | null;
  linkPermission?: string | null;
  scopeKind: AncestorRow["scopeKind"];
  scopeGroupId: string | null;
  scopePermission: SharePermission | null;
}

export interface SummarizeAudienceOptions {
  /** Whether the viewer may manage sharing on this page. Gates `people`. */
  canManageSharing: (pageId: string) => boolean;
  /** Governing scope per page; computed from `rows` when omitted. */
  governingByPageId?: ReadonlyMap<string, AncestorRow | null>;
}

const PEOPLE_SHOWN = 3;
const PEOPLE_KINDS = new Set<Audience["kind"]>(["private", "people", "group", "project"]);

function tier(p: SharePermission | string | null | undefined, fallback: AudiencePermission): AudiencePermission {
  if (p === "View" || p === "Comment" || p === "Edit") return p;
  if (p === "FullAccess") return "Edit";
  return fallback;
}

function highest(perms: SharePermission[]): AudiencePermission {
  const best = perms.reduce<SharePermission>(
    (b, p) => (PERMISSION_RANK[p] > PERMISSION_RANK[b] ? p : b),
    "View",
  );
  return tier(best, "View");
}

async function countMeetingEditors(pageIds: string[]): Promise<Map<string, number>> {
  const grants = await prisma.meetingShareGrant.findMany({
    where: { pageId: { in: pageIds } },
    select: { pageId: true, principalType: true, principalId: true },
  });
  const groupIds = [...new Set(grants.filter((g) => g.principalType === "Group").map((g) => g.principalId))];
  const sizes = new Map(
    await Promise.all(groupIds.map(async (id) => [id, (await resolveGroupMembers(id)).length] as const)),
  );
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const g of grants) {
    const key = `${g.pageId}:${g.principalType}:${g.principalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const size = g.principalType === "User" ? 1 : (sizes.get(g.principalId) ?? 0);
    counts.set(g.pageId, (counts.get(g.pageId) ?? 0) + size);
  }
  return counts;
}

type ShareRow = { pageId: string; principalType: string; principalId: string; permission: SharePermission };

export async function summarizeAudience(
  viewerId: string,
  rows: ReadonlyArray<AudiencePageRow>,
  opts: SummarizeAudienceOptions,
): Promise<Map<string, Audience>> {
  const result = new Map<string, Audience>();
  if (rows.length === 0) return result;

  const governingOf = opts.governingByPageId ?? governingScopeMap(rows as ReadonlyArray<AudiencePageRow & AncestorRow>);
  const titleById = new Map(rows.map((r) => [r.id, r.title]));

  const groupScopeIds = [
    ...new Set(
      rows.flatMap((r) => {
        const g = governingOf.get(r.id);
        return g?.scopeKind === "Group" && g.scopeGroupId ? [g.scopeGroupId] : [];
      }),
    ),
  ];

  const [shareRows, groups] = await Promise.all([
    prisma.pageShare.findMany({
      where: { pageId: { in: rows.map((r) => r.id) } },
      select: { pageId: true, principalType: true, principalId: true, permission: true },
    }) as Promise<ShareRow[]>,
    groupScopeIds.length
      ? prisma.groupDefinition.findMany({
          where: { id: { in: groupScopeIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const meetingEditors = await countMeetingEditors(rows.map((r) => r.id));

  const sharesByPage = new Map<string, ShareRow[]>();
  for (const s of shareRows) {
    const list = sharesByPage.get(s.pageId);
    if (list) list.push(s);
    else sharesByPage.set(s.pageId, [s]);
  }
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const drafts = rows.map((row) => {
    const shares = sharesByPage.get(row.id) ?? [];
    const governing = governingOf.get(row.id) ?? null;
    const inheritedFrom =
      governing && governing.id !== row.id
        ? { id: governing.id, title: governing.title ?? titleById.get(governing.id) ?? "" }
        : null;
    const { viaScope, ...base } = summarizeOne(viewerId, row, governing, shares, groupName);
    const canManage = opts.canManageSharing(row.id);
    const audience: Audience = {
      ...base,
      ...(shares.length > 0 ? { count: shares.length } : {}),
      ...(viaScope && inheritedFrom ? { inheritedFrom } : {}),
      ...(canManage ? { canManage: true } : {}),
      ...(meetingEditors.get(row.id) ? { meetingEditors: meetingEditors.get(row.id) } : {}),
    };
    return { row, shares, audience, canManage };
  });

  const peopleFor = new Map<string, string[]>();
  for (const { row, shares, audience, canManage } of drafts) {
    if (!PEOPLE_KINDS.has(audience.kind) || !canManage) continue;
    const userIds = shares.filter((s) => s.principalType === "User").map((s) => s.principalId);
    if (userIds.length > 0) peopleFor.set(row.id, userIds.slice(0, PEOPLE_SHOWN));
  }

  const wantedUserIds = [...new Set([...peopleFor.values()].flat())];
  const users = wantedUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: wantedUserIds } },
        select: { id: true, firstName: true, lastName: true, photoUrl: true },
      })
    : [];
  const personById = new Map<string, AudiencePerson>(
    users.map((u) => [
      u.id,
      { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() || "Unknown member", photoUrl: u.photoUrl ?? null },
    ]),
  );

  for (const { row, audience } of drafts) {
    const people = (peopleFor.get(row.id) ?? [])
      .map((id) => personById.get(id))
      .filter((p): p is AudiencePerson => !!p);
    result.set(row.id, people.length > 0 ? { ...audience, people } : audience);
  }
  return result;
}

type Core = Pick<Audience, "kind" | "label" | "permission"> & { viaScope?: boolean };

function summarizeOne(
  viewerId: string,
  row: AudiencePageRow,
  governing: AncestorRow | null,
  shares: ShareRow[],
  groupName: ReadonlyMap<string, string>,
): Core {
  if (row.linkAccess === "Public") {
    return { kind: "public", label: "Anyone with the link", permission: "View" };
  }
  if (row.linkAccess === "LabMembers") {
    return { kind: "lab", label: "Everyone in the lab", permission: tier(row.linkPermission, "View") };
  }
  if (row.linkAccess === "SignedIn") {
    return { kind: "public", label: "Anyone signed in", permission: tier(row.linkPermission, "View") };
  }

  const ownerLabel = row.createdById === viewerId ? "Only you" : "Owner only";

  if (governing) {
    switch (governing.scopeKind) {
      case "Group":
        return {
          kind: "group",
          label: (governing.scopeGroupId && groupName.get(governing.scopeGroupId)) || "A group",
          permission: tier(governing.scopePermission, "Edit"),
          viaScope: true,
        };
      case "Lab":
        return {
          kind: "lab",
          label: "Everyone in the lab",
          permission: tier(governing.scopePermission, "View"),
          viaScope: true,
        };
      default:
        return {
          kind: "private",
          label: ownerLabel,
          permission: tier(governing.scopePermission, "Edit"),
          viaScope: true,
        };
    }
  }

  switch (row.workspaceType) {
    case "Project":
      return { kind: "project", label: "Project team · lab can view", permission: "Edit" };
    case "EducationOffering":
      return { kind: "project", label: "Instructors · lab can view", permission: "Edit" };
    case "Member":
      return { kind: "private", label: ownerLabel, permission: "Edit" };
    default:
      if (shares.length > 0) {
        return {
          kind: "people",
          label: `Shared with ${shares.length} ${shares.length === 1 ? "person or group" : "people and groups"}`,
          permission: highest(shares.map((s) => s.permission)),
        };
      }
      return { kind: "private", label: ownerLabel, permission: "Edit" };
  }
}

/**
 * The Share dialog's view of one page: its audience, and the folder scope it
 * inherits (if any), from a single ancestor walk. Names are not resolved here
 * (the dialog lists the people itself).
 */
export async function describePageAudience(
  viewerId: string,
  pageId: string,
): Promise<{ audience: Audience | null; inherited: InheritedScope | null }> {
  const row = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      parentPageId: true,
      workspaceType: true,
      createdById: true,
      linkAccess: true,
      linkPermission: true,
      scopeKind: true,
      scopeGroupId: true,
      scopePermission: true,
    },
  });
  if (!row) return { audience: null, inherited: null };

  const governing = await findGoverningScopeFor(row);
  const audience =
    (
      await summarizeAudience(viewerId, [row], {
        governingByPageId: new Map([[row.id, governing]]),
        canManageSharing: () => false,
      })
    ).get(row.id) ?? null;

  if (!governing || governing.id === row.id || !governing.scopeKind) return { audience, inherited: null };

  const group =
    governing.scopeKind === "Group" && governing.scopeGroupId
      ? await prisma.groupDefinition.findUnique({
          where: { id: governing.scopeGroupId },
          select: { name: true },
        })
      : null;
  return {
    audience,
    inherited: {
      folderId: governing.id,
      title: governing.title ?? "",
      scopeKind: governing.scopeKind,
      groupName: group?.name ?? null,
      permission: tier(governing.scopePermission, governing.scopeKind === "Lab" ? "View" : "Edit"),
    },
  };
}
