import { prisma } from "~/lib/db";
import {
  vaultwardenClient,
  vaultwardenConfigured,
  VW_STATUS,
  type VaultwardenClient,
} from "~/lib/vaultwarden";
import { currentTerm } from "~/lib/roles";
import { slackErrorMessage } from "~/slack/lib/slack-client";

// Add-only, idempotent sync of ONE project's roster into its Vaultwarden org
// GROUP, plus (optionally) a grant of that group onto the project's secrets
// COLLECTION. Mirrors github-team-sync.ts:
//
//  - Members are resolved by User.daliEmail; rostered members with no DALI
//    email are reported (missingEmails), not synced.
//  - A rostered person who isn't yet an org member is INVITED by email
//    (Vaultwarden emails them the join link). They then have a member row and
//    are folded into the group on the same run.
//  - Group membership is set with a single PUT to `currentUsers ∪ roster` — an
//    add-only union, so re-runs never remove anyone (departures are handled out
//    of band, like the GitHub sync). Same for the collection grant.
//  - CONFIRMATION is NOT automated: confirming a member re-encrypts the org key
//    to their public key (crypto the API-key bot can't do). Members that aren't
//    Confirmed yet are reported (membersUnconfirmed) for a human to confirm in
//    the web vault — the analog of GitHub's "must enable 2FA" per-member note.
//
// `provisionVaultGroup` is the shared core; `syncProjectVault` is the
// ProjectAssignment-backed entry point used by the standalone sweep. The
// staffing-finalize step calls `provisionVaultGroup` directly with the cycle's
// confirmed roster (mirroring how the GitHub/Gmail finalize steps read the
// cycle's staffingAssignment rows rather than ProjectAssignment).

export type VaultRosterEntry = { name: string; email: string | null };

export type MemberError = { email: string; message: string };

export type ProjectVaultSyncReport = {
  projectId: string;
  projectName: string;
  status: "ok" | "skipped" | "error";
  groupId: string | null;
  groupCreated: boolean;
  membersEnsured: number; // roster members present as org members and included in the group PUT
  invited: number; // brand-new invites sent this run (subset of membersEnsured)
  membersUnconfirmed: string[]; // rostered members not yet Confirmed — manual gate
  missingEmails: string[]; // rostered member names with no daliEmail (reported, not synced)
  collectionGranted: boolean; // the project's collection id was granted to the group
  memberErrors: MemberError[];
  message: string;
};

function emptyReport(
  projectId: string,
  projectName: string,
  status: ProjectVaultSyncReport["status"],
  message: string,
): ProjectVaultSyncReport {
  return {
    projectId,
    projectName,
    status,
    groupId: null,
    groupCreated: false,
    membersEnsured: 0,
    invited: 0,
    membersUnconfirmed: [],
    missingEmails: [],
    collectionGranted: false,
    memberErrors: [],
    message,
  };
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

// Core: provision a (user-deduped) roster into a project's group. Assumes the
// caller has already gated on vaultwardenConfigured(). `onGroupEnsured` is
// invoked with the group id when a group is get-or-created for a project that
// had none bound, so the caller can persist it.
export async function provisionVaultGroup(args: {
  projectId: string;
  projectName: string;
  boundGroupId: string | null;
  collectionId: string | null;
  roster: VaultRosterEntry[];
  onGroupEnsured?: (groupId: string) => Promise<void>;
  client?: VaultwardenClient;
}): Promise<ProjectVaultSyncReport> {
  const client = args.client ?? vaultwardenClient();

  const rosterEmails = uniq(
    args.roster.map((m) => m.email).filter((e): e is string => !!e),
  );
  const nameByEmail = new Map(
    args.roster.filter((m) => m.email).map((m) => [m.email!, m.name]),
  );
  const report = emptyReport(args.projectId, args.projectName, "ok", "");
  report.missingEmails = args.roster.filter((m) => !m.email).map((m) => m.name);

  // ── Resolve the group (fatal step — nothing else can proceed without it) ──
  let groupId: string;
  let groupName: string;
  let currentCollectionIds: string[];
  try {
    if (args.boundGroupId) {
      const details = await client.getGroupDetails(args.boundGroupId);
      if (!details) {
        return {
          ...report,
          groupId: args.boundGroupId,
          status: "error",
          message: "Bound Vaultwarden group id not found — clear it or paste a valid one.",
        };
      }
      groupId = details.id;
      groupName = details.name;
      currentCollectionIds = details.collectionIds;
    } else {
      const ensured = await client.ensureGroup(args.projectName);
      groupId = ensured.id;
      groupName = ensured.name;
      report.groupCreated = ensured.created;
      await args.onGroupEnsured?.(groupId);
      const details = ensured.created ? null : await client.getGroupDetails(groupId);
      currentCollectionIds = details?.collectionIds ?? [];
    }
  } catch (err) {
    return { ...report, status: "error", message: slackErrorMessage(err) };
  }
  report.groupId = groupId;

  // ── Resolve members by email; invite anyone not yet in the org ──
  let memberByEmail: Map<string, { id: string; status: number }>;
  try {
    memberByEmail = new Map(
      (await client.listOrgMembers()).map((m) => [m.email, { id: m.id, status: m.status }]),
    );
  } catch (err) {
    return { ...report, status: "error", message: slackErrorMessage(err) };
  }

  for (const email of rosterEmails.filter((e) => !memberByEmail.has(e))) {
    try {
      await client.inviteMember(email, groupId);
      report.invited += 1;
    } catch (err) {
      report.memberErrors.push({ email, message: slackErrorMessage(err) });
    }
  }
  // Re-list so freshly-invited members (now Invited rows with ids) fold into the
  // group PUT below — this is what actually guarantees membership, so we don't
  // depend on invite-time group assignment being supported.
  if (report.invited > 0) {
    try {
      memberByEmail = new Map(
        (await client.listOrgMembers()).map((m) => [m.email, { id: m.id, status: m.status }]),
      );
    } catch {
      /* keep the pre-invite map — the PUT just won't include the new ids yet */
    }
  }

  const rosterMemberIds: string[] = [];
  for (const email of rosterEmails) {
    const m = memberByEmail.get(email);
    if (!m) continue; // invite failed above; already recorded in memberErrors
    rosterMemberIds.push(m.id);
    if (m.status !== VW_STATUS.Confirmed) {
      report.membersUnconfirmed.push(nameByEmail.get(email) ?? email);
    }
  }
  report.membersEnsured = rosterMemberIds.length;

  // ── Single add-only PUT: users = current ∪ roster; collections = current ∪ target ──
  try {
    const currentUserIds = await client.getGroupUserIds(groupId);
    const userIds = uniq([...currentUserIds, ...rosterMemberIds]);
    const collectionIds = args.collectionId
      ? uniq([...currentCollectionIds, args.collectionId])
      : currentCollectionIds;
    await client.updateGroup(groupId, { name: groupName, collectionIds, userIds });
    report.collectionGranted = !!args.collectionId;
  } catch (err) {
    report.memberErrors.push({ email: "(group update)", message: slackErrorMessage(err) });
  }

  report.status = report.memberErrors.length > 0 ? "error" : "ok";
  report.message = summarize(report);
  return report;
}

// Standalone entry point (used by POST /api/staffing/sync-vault): reads the
// project's current-term ProjectAssignment roster and provisions it.
export async function syncProjectVault(
  projectId: string,
  termId?: string,
  client: VaultwardenClient = vaultwardenClient(),
): Promise<ProjectVaultSyncReport> {
  if (!vaultwardenConfigured()) {
    return emptyReport(projectId, projectId, "skipped", "Vaultwarden is not configured.");
  }

  let tid = termId;
  if (!tid) {
    const t = await currentTerm();
    if (!t) return emptyReport(projectId, projectId, "skipped", "No current term.");
    tid = t.id;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      vaultwardenGroupId: true,
      vaultwardenCollectionId: true,
      assignments: {
        where: { termId: tid },
        select: { user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
      },
    },
  });
  if (!project) return emptyReport(projectId, projectId, "skipped", "Project not found.");

  // Dedupe by user id (a user holds one ProjectAssignment row per domain).
  const byUser = new Map<string, VaultRosterEntry>();
  for (const a of project.assignments) {
    byUser.set(a.user.id, {
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      email: a.user.daliEmail?.trim().toLowerCase() || null,
    });
  }

  return provisionVaultGroup({
    projectId: project.id,
    projectName: project.name,
    boundGroupId: project.vaultwardenGroupId,
    collectionId: project.vaultwardenCollectionId,
    roster: [...byUser.values()],
    onGroupEnsured: async (groupId) => {
      await prisma.project.update({
        where: { id: project.id },
        data: { vaultwardenGroupId: groupId },
      });
    },
    client,
  });
}

function summarize(r: ProjectVaultSyncReport): string {
  const parts = [
    `${r.groupCreated ? "created" : "found"} group`,
    `ensured ${r.membersEnsured} member${r.membersEnsured === 1 ? "" : "s"}${
      r.invited ? ` (${r.invited} invited)` : ""
    }`,
  ];
  if (r.collectionGranted) parts.push("granted collection");
  if (r.membersUnconfirmed.length) {
    parts.push(
      `${r.membersUnconfirmed.length} awaiting confirmation in the web vault (${r.membersUnconfirmed.join(", ")})`,
    );
  }
  if (r.missingEmails.length) {
    parts.push(`${r.missingEmails.length} without a DALI email (${r.missingEmails.join(", ")})`);
  }
  if (r.memberErrors.length) {
    parts.push(`${r.memberErrors.length} error${r.memberErrors.length === 1 ? "" : "s"}`);
  }
  return `${parts.join("; ")}.`;
}
