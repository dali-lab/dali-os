import type { Route } from "./+types/api.staffing.finalize";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import {
  postMessage,
  ensureChannel,
  inviteUsersToChannel,
  slackErrorMessage,
  slackConfigured,
  SLACK_NOT_CONFIGURED_MESSAGE,
} from "~/slack/lib/slack-client";
import { resolveSlackIdsForInvite } from "~/members/lib/slack-sync.server";
import { ensureTeam, addTeamMember } from "~/lib/github";
import {
  workspaceConfigured,
  deriveProjectEmails,
  ensureWorkspaceGroup,
  addGroupMember,
} from "~/lib/google-workspace";
import { logAuditEvent } from "~/lib/audit";
import { notify } from "~/lib/notify.server";
import { dedupeLiveAssignments } from "../lib/staffing-board";
import { publishCycleChange } from "../lib/staffing-events.server";
import { derivePairings } from "../lib/mentorship-pairings";

// POST /api/staffing/finalize
//
// Runs a selected subset of "finalize a project" automations for one project
// within one staffing cycle. Each automation reports its own outcome so the
// modal can show per-step results. Idempotent — safe to re-run.
//
// Automations:
//   - assignments: Proposed StaffingAssignment rows for this project+cycle →
//     Confirmed, and upsert canonical ProjectAssignment + DomainEligibility.
//   - slack:       get-or-create the project's own Slack channel (named after
//                  the project, id cached on Project.slackChannelId), invite
//                  the confirmed roster (by synced slackUserId), and post a team
//                  announcement (members + domain/level, plus repos).
//   - gmail:       get-or-create the project's team Google Group
//                  (<slug>-team@dali.dartmouth.edu, cached on
//                  Project.teamGroupEmail) and add the confirmed roster's DALI
//                  emails as members. No project user account / mailbox is
//                  created (a group needs no password). Env-gated; reports
//                  "skipped" when the Admin SDK isn't configured.
//   - github:      get-or-create the project's GITHUB_ORG team (from
//                  Project.githubTeamSlug) and add the confirmed roster.

// The User fields resolveSlackIdsForInvite needs: stored id + emails to look up.
const SLACK_INVITE_USER_SELECT = {
  id: true,
  slackUserId: true,
  daliEmail: true,
  dartmouthEmail: true,
  personalEmail: true,
} as const;

const AUTOMATIONS = ["assignments", "slack", "gmail", "github"] as const;
type Automation = (typeof AUTOMATIONS)[number];

type StepResult = { status: "ok" | "skipped" | "error"; message: string };

type Body = {
  cycleId: string;
  projectId: string;
  automations: string[];
  // Optional editable overrides from the Finalize modal. Empty/absent = use the
  // project's stored/derived value. When supplied, they are also persisted to the
  // Project (slackChannel → the get-or-created channel's id; githubTeamSlug → the
  // slug field).
  slackChannel?: string;
  githubTeamSlug?: string;
  // When true, persist the channel/slug fields to the Project and skip all
  // automations (the modal's "Save").
  saveFieldsOnly?: boolean;
  // When true, any staged mentor who isn't yet P3 in the mentee's domain is
  // promoted to P3 (assignment + eligibility) as staged pairs are materialized.
  // Off = materialize pairs but leave levels alone. Part of the assignments step.
  promoteMentors?: boolean;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.projectId === "string" &&
    Array.isArray(o.automations) &&
    o.automations.every((a) => typeof a === "string") &&
    (o.slackChannel === undefined || typeof o.slackChannel === "string") &&
    (o.githubTeamSlug === undefined || typeof o.githubTeamSlug === "string") &&
    (o.saveFieldsOnly === undefined || typeof o.saveFieldsOnly === "boolean") &&
    (o.promoteMentors === undefined || typeof o.promoteMentors === "boolean")
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const selected = new Set<Automation>(
    body.automations.filter((a): a is Automation =>
      (AUTOMATIONS as readonly string[]).includes(a),
    ),
  );
  // saveFieldsOnly persists fields with no automations selected, so the empty
  // check only applies to a real automation run.
  if (!body.saveFieldsOnly && selected.size === 0) {
    return withCors(request, Response.json({ error: "No automations selected" }, { status: 400 }));
  }

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: body.cycleId },
    select: { id: true, termId: true, name: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }
  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: {
      id: true,
      name: true,
      githubTeamSlug: true,
      slackChannelId: true,
      slackChannelName: true,
      repoUrls: true,
      teamGroupEmail: true,
    },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  // ── saveFieldsOnly ───────────────────────────────────────────────────────────
  // The Finalize modal's "Save" persists the editable channel name + GitHub slug
  // to the Project WITHOUT running any automations, so the project details page and
  // the modal stay in sync. No Slack/GitHub API calls here — the channel is
  // materialized when an automation actually runs.
  if (body.saveFieldsOnly) {
    const data: { slackChannelName?: string | null; githubTeamSlug?: string | null } = {};
    if (body.slackChannel !== undefined) {
      const v = body.slackChannel.trim();
      data.slackChannelName = v === "" ? null : v;
    }
    if (body.githubTeamSlug !== undefined) {
      const v = body.githubTeamSlug.trim();
      data.githubTeamSlug = v === "" ? null : v;
    }
    if (Object.keys(data).length > 0) {
      await prisma.project.update({ where: { id: project.id }, data });
    }
    return withCors(request, Response.json({ saved: true }));
  }

  const results: Record<Automation, StepResult> = {} as Record<Automation, StepResult>;

  // ── assignments ────────────────────────────────────────────────────────────
  // Run this first; the Slack step reports the roster it produced.
  let confirmedCount = 0;
  if (selected.has("assignments")) {
    try {
      // Finalize REPLACES the confirmed roster: the project's Confirmed set
      // becomes exactly the board's current assignments for it. A member's
      // live card is their Proposed row if present, else their Confirmed row
      // (same dedupe the board does) — so someone dragged onto another project
      // has a Proposed row elsewhere and must NOT stay confirmed here.
      const cycleRows = await prisma.staffingAssignment.findMany({
        where: { staffingCycleId: cycle.id, status: { in: ["Proposed", "Confirmed"] } },
        select: { id: true, userId: true, projectId: true, domainId: true, level: true, status: true },
      });
      // Target roster = members whose live assignment points at THIS project.
      const liveTarget = dedupeLiveAssignments(cycleRows).filter((r) => r.projectId === project.id);
      const targetUserIds = new Set(liveTarget.map((r) => r.userId));

      // An assignment's domainId is unguarded (StaffingAssignment has no FK to
      // Domain), so a blank/stale value can slip in — e.g. a bid whose domain
      // reference resolved to "". ProjectAssignment.domainId DOES have that FK,
      // so finalizing such a row throws an opaque FK violation and rolls back
      // the whole project. Skip those rows and surface the members by name so a
      // lead can fix the bid, instead of crashing the finalize.
      const domains = await prisma.domain.findMany({ select: { id: true, name: true } });
      const validDomainIds = new Set(domains.map((d) => d.id));
      const domainNameById = new Map(domains.map((d) => [d.id, d.name]));
      const target = liveTarget.filter((r) => validDomainIds.has(r.domainId));
      const skippedNames = (
        await prisma.user.findMany({
          where: { id: { in: liveTarget.filter((r) => !validDomainIds.has(r.domainId)).map((r) => r.userId) } },
          select: { firstName: true, lastName: true },
        })
      ).map((u) => `${u.firstName} ${u.lastName}`.trim());

      // Members currently Confirmed on this project who are no longer in the
      // target roster (dragged off / to another project / unassigned). Decline
      // their stale Confirmed rows and drop the ProjectAssignment for this
      // project+cycle. DomainEligibility is left intact — it's monotonic and a
      // promotion already granted isn't revoked by re-staffing.
      const droppedRows = cycleRows.filter(
        (r) => r.status === "Confirmed" && r.projectId === project.id && !targetUserIds.has(r.userId),
      );

      let droppedCount = 0;
      let pairsCreated = 0;
      let mentorsPromoted = 0;
      const promoteMentors = body.promoteMentors === true;
      await prisma.$transaction(async (tx) => {
        for (const a of target) {
          if (a.status !== "Confirmed") {
            await tx.staffingAssignment.update({ where: { id: a.id }, data: { status: "Confirmed" } });
          }
          await tx.projectAssignment.upsert({
            where: {
              userId_projectId_termId_domainId: {
                userId: a.userId,
                projectId: project.id,
                termId: cycle.termId,
                domainId: a.domainId,
              },
            },
            update: { level: a.level },
            create: {
              userId: a.userId,
              projectId: project.id,
              termId: cycle.termId,
              domainId: a.domainId,
              level: a.level,
            },
          });
          // Eligibility is monotonic (only goes up); but the staffing lead
          // is the authority here, so mirror the assigned level.
          await tx.domainEligibility.upsert({
            where: { userId_domainId: { userId: a.userId, domainId: a.domainId } },
            update: { level: a.level, promotedBy: auth.user.sub },
            create: {
              userId: a.userId,
              domainId: a.domainId,
              level: a.level,
              promotedBy: auth.user.sub,
            },
          });
          confirmedCount++;
        }

        for (const d of droppedRows) {
          await tx.staffingAssignment.update({ where: { id: d.id }, data: { status: "Declined" } });
          await tx.projectAssignment.deleteMany({
            where: {
              userId: d.userId,
              projectId: project.id,
              termId: cycle.termId,
              domainId: d.domainId,
            },
          });
          droppedCount++;
        }

        // Mentor/mentee roles: default by level (P3 → mentor), overridden per
        // card on the staffing board (StaffingMentorRole).
        const overrideRows = await tx.staffingMentorRole.findMany({
          where: { staffingCycleId: cycle.id },
          select: { userId: true, isMentor: true },
        });
        const roleOverride = new Map(overrideRows.map((r) => [r.userId, r.isMentor]));

        // A mentor must be P3 in the domain they mentor. Any override-driven
        // mentor still below P3 on this project is promoted (eligibility + live
        // rows) so the derived pairing is valid — default mentors are P3 already.
        if (promoteMentors) {
          const overrideMentorIds = overrideRows.filter((r) => r.isMentor).map((r) => r.userId);
          if (overrideMentorIds.length > 0) {
            const belowP3 = await tx.projectAssignment.findMany({
              where: {
                projectId: project.id,
                termId: cycle.termId,
                userId: { in: overrideMentorIds },
                level: { not: "P3" },
              },
              select: { userId: true, domainId: true },
            });
            const promoted = new Set<string>();
            for (const r of belowP3) {
              await tx.domainEligibility.upsert({
                where: { userId_domainId: { userId: r.userId, domainId: r.domainId } },
                update: { level: "P3", promotedBy: auth.user.sub },
                create: { userId: r.userId, domainId: r.domainId, level: "P3", promotedBy: auth.user.sub },
              });
              await tx.projectAssignment.updateMany({
                where: { userId: r.userId, termId: cycle.termId, domainId: r.domainId },
                data: { level: "P3" },
              });
              await tx.staffingAssignment.updateMany({
                where: {
                  userId: r.userId,
                  staffingCycleId: cycle.id,
                  domainId: r.domainId,
                  status: { not: "Declined" },
                },
                data: { level: "P3" },
              });
              promoted.add(r.userId);
            }
            mentorsPromoted += promoted.size;
          }
        }

        // Non-roster external mentors placed on this project — they mentor the
        // project's same-domain mentees but aren't staffed (no ProjectAssignment,
        // no GitHub/Slack automation).
        const externalMentors = await tx.externalMentor.findMany({
          where: { staffingCycleId: cycle.id, projectId: project.id },
          select: { userId: true, domainId: true },
        });

        // Auto-pair mentees to mentors from the confirmed roster, honouring the
        // role overrides and external mentors. Additive only — preserves Core
        // overrides made via /mentorship/pairs.
        pairsCreated = await derivePairings(tx, project.id, cycle.termId, {
          roleOverride,
          externalMentors,
        });
      });

      // Tell each newly-confirmed member (rows that were still Proposed when
      // this run started) — finalize is idempotent and re-runs must not
      // re-notify the whole roster. Fire-and-forget: delivery never fails the
      // finalize.
      const newlyConfirmed = target.filter((a) => a.status !== "Confirmed");
      if (newlyConfirmed.length > 0) {
        void notify({
          eventType: "staffing.assigned",
          createdByUserId: auth.user.sub,
          message: {
            title: `You're on ${project.name}`,
            link: `/projects/${project.id}`,
          },
          recipients: newlyConfirmed.map((a) => ({
            userId: a.userId,
            body: `${domainNameById.get(a.domainId) ?? "Unknown domain"} — ${a.level}, ${cycle.name}.`,
          })),
        }).catch((err) =>
          console.error(`staffing finalize ${project.id}: notify failed`, err),
        );
      }

      const dropNote = droppedCount > 0 ? `, removed ${droppedCount}` : "";
      const pairNote = pairsCreated > 0 ? `, paired ${pairsCreated} mentor link${pairsCreated === 1 ? "" : "s"}` : "";
      const promoteNote =
        mentorsPromoted > 0 ? `, promoted ${mentorsPromoted} mentor${mentorsPromoted === 1 ? "" : "s"} to P3` : "";
      const skipNote =
        skippedNames.length > 0
          ? ` Skipped ${skippedNames.length} with an invalid/blank domain (fix their bid): ${skippedNames.join(", ")}.`
          : "";
      results.assignments = {
        // Flag as error when anyone was skipped so the lead sees the warning and
        // follows up — the valid assignments still went through.
        status: skippedNames.length > 0 ? "error" : "ok",
        message:
          (confirmedCount === 0 && droppedCount === 0
            ? "No proposed assignments for this project."
            : `Confirmed ${confirmedCount} assignment${confirmedCount === 1 ? "" : "s"}${dropNote}${pairNote}${promoteNote} → ProjectAssignment.`) +
          skipNote,
      };
    } catch (err) {
      results.assignments = { status: "error", message: slackErrorMessage(err) };
    }
  }

  // ── slack ──────────────────────────────────────────────────────────────────
  // Per-project channel: get-or-create one named after the project, invite the
  // confirmed roster (by their synced slackUserId), and post a team
  // announcement (each member's domain + level, plus the project's repos). The
  // channel id is reused across runs (stored on Project.slackChannelId).
  if (selected.has("slack")) {
    if (!slackConfigured()) {
      results.slack = { status: "skipped" as const, message: SLACK_NOT_CONFIGURED_MESSAGE };
    } else {
      try {
        // Confirmed roster with level + slack id, regardless of whether the
        // assignments step ran this invocation. StaffingAssignment has no domain
        // RELATION (only domainId), so resolve display names separately.
        const roster = await prisma.staffingAssignment.findMany({
          where: { staffingCycleId: cycle.id, projectId: project.id, status: "Confirmed" },
          select: {
            level: true,
            domainId: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                slackUserId: true,
                daliEmail: true,
                dartmouthEmail: true,
                personalEmail: true,
              },
            },
          },
        });
        // Effective mentors (role override ?? P3) + external mentors, so the
        // announcement marks who's a mentor and groups everyone by domain.
        const [overrideRows, externalRows] = await Promise.all([
          prisma.staffingMentorRole.findMany({
            where: { staffingCycleId: cycle.id },
            select: { userId: true, isMentor: true },
          }),
          prisma.externalMentor.findMany({
            where: { staffingCycleId: cycle.id, projectId: project.id },
            select: {
              domainId: true,
              user: { select: { firstName: true, lastName: true } },
            },
          }),
        ]);
        const overrideByUser = new Map(overrideRows.map((r) => [r.userId, r.isMentor]));
        const domainIds = [
          ...new Set([
            ...roster.map((r) => r.domainId),
            ...externalRows.map((e) => e.domainId),
          ]),
        ];
        const domainNames = new Map(
          (
            await prisma.domain.findMany({
              where: { id: { in: domainIds } },
              select: { id: true, displayName: true },
            })
          ).map((d) => [d.id, d.displayName]),
        );

        // 1. Resolve the channel. The desired name is the modal edit, else the
        //    stored shared name, else the project name. Reuse the stored id unless
        //    there's none yet or the desired name differs — then get-or-create and
        //    persist BOTH the resulting id and the name (shared with project
        //    details).
        const desiredName =
          body.slackChannel?.trim() || project.slackChannelName || project.name;
        let channelId = project.slackChannelId;
        let channelNote = "reused channel";
        const nameChanged = desiredName !== project.slackChannelName;
        if (!channelId || nameChanged) {
          const ch = await ensureChannel(desiredName);
          channelId = ch.id;
          channelNote = ch.created ? `created #${ch.name}` : `found #${ch.name}`;
          await prisma.project.update({
            where: { id: project.id },
            data: { slackChannelId: channelId, slackChannelName: desiredName },
          });
        }

        // 2. Build the invite set: confirmed roster + all current-term Core + all
        //    Admin/staff. resolveSlackIdsForInvite uses each user's stored
        //    slackUserId, OR looks it up by email and persists it for next time —
        //    so members who never visited Settings → Slack still get invited.
        const [coreRows, adminRows] = await Promise.all([
          prisma.coreAssignment.findMany({
            where: { termId: cycle.termId },
            select: { user: { select: SLACK_INVITE_USER_SELECT } },
          }),
          prisma.adminMembership.findMany({
            select: { user: { select: SLACK_INVITE_USER_SELECT } },
          }),
        ]);
        const candidates = [
          ...roster.map((r) => r.user),
          ...coreRows.map((r) => r.user),
          ...adminRows.map((r) => r.user),
        ];
        const { slackIds, unresolvedUserIds } = await resolveSlackIdsForInvite(candidates);
        const missingMembers = unresolvedUserIds.length;
        const inv = await inviteUsersToChannel(channelId, slackIds);

        // 3. Announce the team, grouped by domain. Each name is tagged "(mentor)"
        // when they're an effective mentor (role override, else P3) or an
        // external mentor. Domains and names sort alphabetically, mentors first.
        type Line = { name: string; isMentor: boolean };
        const byDomain = new Map<string, Line[]>();
        const pushLine = (domainId: string, line: Line) => {
          const list = byDomain.get(domainId) ?? [];
          list.push(line);
          byDomain.set(domainId, list);
        };
        for (const r of roster) {
          pushLine(r.domainId, {
            name: `${r.user.firstName} ${r.user.lastName}`.trim(),
            isMentor: overrideByUser.get(r.user.id) ?? r.level === "P3",
          });
        }
        for (const e of externalRows) {
          pushLine(e.domainId, {
            name: `${e.user.firstName} ${e.user.lastName}`.trim(),
            isMentor: true,
          });
        }
        const domainSections = [...byDomain.entries()]
          .map(([domainId, members]) => ({
            domain: domainNames.get(domainId) ?? "Unassigned domain",
            members: members.sort(
              (a, b) =>
                Number(b.isMentor) - Number(a.isMentor) || a.name.localeCompare(b.name),
            ),
          }))
          .sort((a, b) => a.domain.localeCompare(b.domain));
        const teamBlock =
          domainSections.length > 0
            ? domainSections
                .map(
                  (s) =>
                    `*${s.domain}*\n` +
                    s.members
                      .map((m) => `• ${m.name}${m.isMentor ? " (mentor)" : ""}`)
                      .join("\n"),
                )
                .join("\n\n")
            : "_No confirmed members yet._";
        const repoLines = (project.repoUrls ?? []).map((u) => `• ${u}`);
        const text =
          `*${project.name}* is staffed for ${cycle.name}! :tada:\n\n` +
          `*Team*\n${teamBlock}` +
          (repoLines.length > 0 ? `\n\n*Repos*\n${repoLines.join("\n")}` : "");
        await postMessage(channelId, text);

        const parts = [
          channelNote,
          `invited ${inv.invited} (members + core + admin)`,
          `announced ${roster.length} member(s)`,
        ];
        if (missingMembers > 0) {
          parts.push(`${missingMembers} without a Slack account (no email match)`);
        }
        results.slack = { status: "ok", message: `${parts.join("; ")}.` };
      } catch (err) {
        results.slack = { status: "error", message: slackErrorMessage(err) };
      }
    }
  }

  // ── gmail ──────────────────────────────────────────────────────────────────
  // Provision the project's team Google Group:
  //   GROUP <slug>-team@dali.dartmouth.edu — get-or-created, cached on
  //   Project.teamGroupEmail, with the confirmed roster's DALI emails added as
  //   members. A roster member without a daliEmail is skipped + reported.
  // No project USER account is created — a group needs no password, so there's
  // nothing to provision a mailbox or credential for. (Project.calendarEmail
  // remains a manually-set field on the project page, untouched here.)
  // Re-runnable: every Directory API call treats "already exists" (409) as
  // success and we never remove members.
  if (selected.has("gmail")) {
    if (!workspaceConfigured()) {
      results.gmail = {
        status: "skipped",
        message: "Google Workspace provisioning is not configured.",
      };
    } else {
      try {
        // Use the project's existing group address when set; otherwise derive
        // from the project name and backfill so later runs reuse it.
        const groupEmail =
          project.teamGroupEmail?.trim() || deriveProjectEmails(project.name).groupEmail;

        const parts: string[] = [];

        const group = await ensureWorkspaceGroup({
          email: groupEmail,
          name: `${project.name} Team`,
        });
        if (group.status === "error") {
          results.gmail = { status: "error", message: `Group: ${group.message}` };
        } else {
          parts.push(
            group.status === "ok"
              ? `${group.created ? "created" : "found"} group ${group.email}`
              : `group ${group.message}`,
          );
          if (group.status === "ok" && !project.teamGroupEmail) {
            await prisma.project.update({
              where: { id: project.id },
              data: { teamGroupEmail: group.email },
            });
          }

          // Add the confirmed roster's DALI emails to the group.
          if (group.status === "ok") {
            const roster = await prisma.staffingAssignment.findMany({
              where: {
                staffingCycleId: cycle.id,
                projectId: project.id,
                status: "Confirmed",
              },
              select: {
                user: { select: { firstName: true, lastName: true, daliEmail: true } },
              },
            });
            const emails = new Set<string>();
            const missing: string[] = [];
            for (const r of roster) {
              const e = r.user.daliEmail?.trim();
              if (e) emails.add(e);
              else missing.push(`${r.user.firstName} ${r.user.lastName}`);
            }

            let added = 0;
            let already = 0;
            const memberErrors: string[] = [];
            for (const email of emails) {
              const m = await addGroupMember({ groupEmail: group.email, memberEmail: email });
              if (m.status === "error") memberErrors.push(`${email}: ${m.message}`);
              else if (m.added) added++;
              else already++;
            }

            parts.push(`added ${added} member${added === 1 ? "" : "s"}`);
            if (already > 0) parts.push(`${already} already in group`);
            if (missing.length > 0) {
              parts.push(`skipped ${missing.length} with no DALI email (${missing.join(", ")})`);
            }
            results.gmail = {
              status: memberErrors.length > 0 ? "error" : "ok",
              message:
                memberErrors.length > 0
                  ? `${parts.join("; ")}; errors: ${memberErrors.join("; ")}`
                  : `${parts.join("; ")}.`,
            };
          }
        }
      } catch (err) {
        results.gmail = { status: "error", message: slackErrorMessage(err) };
      }
    }
  }

  // ── github ───────────────────────────────────────────────────────────────
  // Get-or-create the project's org team (Project.githubTeamSlug, persistent
  // across terms) and add the confirmed roster. Re-runnable: ensureTeam and the
  // membership PUT are both idempotent, and we never remove anyone. Roster
  // members without a stored githubUsername are skipped and reported.
  if (selected.has("github")) {
    // The slug is editable in the Finalize modal; an edit overrides (and is
    // persisted to) Project.githubTeamSlug, so it no longer has to be pre-set on
    // the project page.
    const slug = body.githubTeamSlug?.trim() || project.githubTeamSlug;
    if (!process.env.GITHUB_ORG) {
      results.github = { status: "skipped", message: "GITHUB_ORG not set." };
    } else if (!slug) {
      results.github = {
        status: "skipped",
        message: "No GitHub team slug provided — enter one in the Finalize modal.",
      };
    } else if (
      (await prisma.project.count({
        where: { id: { not: project.id }, githubTeamSlug: { equals: slug, mode: "insensitive" } },
      })) > 0
    ) {
      // Another project already owns this slug — ensureTeam would merge their
      // rosters into one team. Skip, matching the sync-teams sweep's guard.
      results.github = {
        status: "skipped",
        message: `GitHub team slug "${slug}" is used by another project — skipped to avoid merging teams. Set a unique slug.`,
      };
    } else {
      try {
        const roster = await prisma.staffingAssignment.findMany({
          where: { staffingCycleId: cycle.id, projectId: project.id, status: "Confirmed" },
          select: {
            user: {
              select: { firstName: true, lastName: true, githubUsername: true },
            },
          },
        });
        // Distinct usernames among the roster; collect those missing a handle
        // so the lead knows who to follow up with.
        const withHandle = new Set<string>();
        const missing: string[] = [];
        for (const r of roster) {
          const handle = r.user.githubUsername?.trim();
          if (handle) withHandle.add(handle);
          else missing.push(`${r.user.firstName} ${r.user.lastName}`);
        }

        const team = await ensureTeam(slug);
        for (const username of withHandle) {
          await addTeamMember(team.slug, username);
        }
        // Persist the slug if the lead changed it (so future runs reuse it).
        if (slug !== project.githubTeamSlug) {
          await prisma.project.update({
            where: { id: project.id },
            data: { githubTeamSlug: slug },
          });
        }

        const parts = [
          `${team.created ? "Created" : "Updated"} team "${team.slug}"`,
          `added ${withHandle.size} member${withHandle.size === 1 ? "" : "s"}`,
        ];
        if (missing.length > 0) {
          parts.push(`skipped ${missing.length} with no GitHub username (${missing.join(", ")})`);
        }
        results.github = { status: "ok", message: `${parts.join("; ")}.` };
      } catch (err) {
        results.github = { status: "error", message: slackErrorMessage(err) };
      }
    }
  }

  await logAuditEvent({
    action: "staffing.finalize",
    userId: auth.user.sub,
    targetId: project.id,
    metadata: {
      cycleId: cycle.id,
      automations: Array.from(selected),
      confirmedCount,
      results,
    },
    request,
  });

  // Finalize confirms/removes assignments — push so every open board reflects
  // the new roster (cards moving from Proposed to finalized, drops disappearing).
  publishCycleChange(cycle.id);

  return withCors(request, Response.json({ results }));
}
