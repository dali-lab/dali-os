// Extracted core of POST /api/staffing/finalize so both the route action and
// the MCP `finalize_staffing` tool can call the same logic without duplicating
// the ~300-line automation body.
//
// Callers supply: actorId (the user executing the operation), body (validated
// request payload), and a Request object for logAuditEvent (may be a synthetic
// Request in the MCP path).

import { prisma } from "~/lib/db";
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
import { notifyAdminsOfPromotion, isLevelAdvance } from "~/lib/promotion-notify.server";
import type { Level } from "~/lib/level";
import { dedupeLiveAssignments } from "./staffing-board";
import { publishCycleChange } from "./staffing-events.server";
import { derivePairings, findDomainsMissingMentors } from "./mentorship-pairings";

const AUTOMATIONS = ["assignments", "slack", "gmail", "github"] as const;
type Automation = (typeof AUTOMATIONS)[number];

type StepResult = { status: "ok" | "skipped" | "error"; message: string };

function summarize(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

const SLACK_INVITE_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  slackUserId: true,
  daliEmail: true,
  dartmouthEmail: true,
  personalEmail: true,
} as const;

export type FinalizeStaffingBody = {
  cycleId: string;
  projectId: string;
  automations: string[];
  slackChannel?: string;
  githubTeamSlug?: string;
  saveFieldsOnly?: boolean;
  promoteMentors?: boolean;
};

export type FinalizeStaffingResult =
  | { saved: true }
  | { results: Record<Automation, StepResult> };

export async function finalizeStaffing(
  actorId: string,
  body: FinalizeStaffingBody,
  request: Request,
): Promise<FinalizeStaffingResult> {
  const selected = new Set<Automation>(
    body.automations.filter((a): a is Automation =>
      (AUTOMATIONS as readonly string[]).includes(a),
    ),
  );

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: body.cycleId },
    select: { id: true, termId: true, name: true },
  });
  if (!cycle) throw new Error("Cycle not found");

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
  if (!project) throw new Error("Project not found");

  // ── saveFieldsOnly ──────────────────────────────────────────────────────────
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
    return { saved: true };
  }

  const results: Record<Automation, StepResult> = {} as Record<Automation, StepResult>;

  // ── assignments ─────────────────────────────────────────────────────────────
  let confirmedCount = 0;
  if (selected.has("assignments")) {
    try {
      const cycleRows = await prisma.staffingAssignment.findMany({
        where: { staffingCycleId: cycle.id, status: { in: ["Proposed", "Confirmed"] } },
        select: {
          id: true,
          userId: true,
          projectId: true,
          domainId: true,
          level: true,
          status: true,
        },
      });
      const liveTarget = dedupeLiveAssignments(cycleRows).filter(
        (r) => r.projectId === project.id,
      );
      const targetKeys = new Set(liveTarget.map((r) => `${r.userId}|${r.domainId}`));

      const domains = await prisma.domain.findMany({ select: { id: true, name: true } });
      const validDomainIds = new Set(domains.map((d) => d.id));
      const domainNameById = new Map(domains.map((d) => [d.id, d.name]));
      const target = liveTarget.filter((r) => validDomainIds.has(r.domainId));
      const skippedNames = (
        await prisma.user.findMany({
          where: {
            id: {
              in: liveTarget
                .filter((r) => !validDomainIds.has(r.domainId))
                .map((r) => r.userId),
            },
          },
          select: { firstName: true, lastName: true },
        })
      ).map((u) => `${u.firstName} ${u.lastName}`.trim());

      const droppedRows = cycleRows.filter(
        (r) =>
          r.status === "Confirmed" &&
          r.projectId === project.id &&
          !targetKeys.has(`${r.userId}|${r.domainId}`),
      );

      let droppedCount = 0;
      let pairsCreated = 0;
      let mentorsPromoted = 0;
      let mentorshipGaps: { domainId: string; menteeUserIds: string[] }[] = [];
      const promoteMentors = body.promoteMentors === true;
      const eligBumps = new Map<
        string,
        { userId: string; domainId: string; from: Level | null; to: Level }
      >();

      await prisma.$transaction(async (tx) => {
        const recordElig = async (userId: string, domainId: string, to: Level) => {
          const key = `${userId}:${domainId}`;
          const existing = eligBumps.get(key);
          if (existing) {
            existing.to = to;
            return;
          }
          const cur = await tx.domainEligibility.findUnique({
            where: { userId_domainId: { userId, domainId } },
            select: { level: true },
          });
          eligBumps.set(key, { userId, domainId, from: cur?.level ?? null, to });
        };

        for (const a of target) {
          if (a.status !== "Confirmed") {
            await tx.staffingAssignment.update({
              where: { id: a.id },
              data: { status: "Confirmed" },
            });
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
          await recordElig(a.userId, a.domainId, a.level);
          await tx.domainEligibility.upsert({
            where: { userId_domainId: { userId: a.userId, domainId: a.domainId } },
            update: { level: a.level, promotedBy: actorId },
            create: {
              userId: a.userId,
              domainId: a.domainId,
              level: a.level,
              promotedBy: actorId,
            },
          });
          confirmedCount++;
        }

        for (const d of droppedRows) {
          await tx.staffingAssignment.update({
            where: { id: d.id },
            data: { status: "Declined" },
          });
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

        const overrideRows = await tx.staffingMentorRole.findMany({
          where: { staffingCycleId: cycle.id },
          select: { userId: true, isMentor: true },
        });
        const roleOverride = new Map(overrideRows.map((r) => [r.userId, r.isMentor]));

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
              await recordElig(r.userId, r.domainId, "P3");
              await tx.domainEligibility.upsert({
                where: { userId_domainId: { userId: r.userId, domainId: r.domainId } },
                update: { level: "P3", promotedBy: actorId },
                create: {
                  userId: r.userId,
                  domainId: r.domainId,
                  level: "P3",
                  promotedBy: actorId,
                },
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

        const externalMentors = await tx.externalMentor.findMany({
          where: { staffingCycleId: cycle.id, projectId: project.id },
          select: { userId: true, domainId: true },
        });

        pairsCreated = await derivePairings(tx, project.id, cycle.termId, {
          roleOverride,
          externalMentors,
        });

        const roster = await tx.projectAssignment.findMany({
          where: { projectId: project.id, termId: cycle.termId },
          select: { userId: true, domainId: true, level: true },
        });
        mentorshipGaps = findDomainsMissingMentors(roster, { roleOverride, externalMentors });
      });

      const newlyConfirmed = target.filter((a) => a.status !== "Confirmed");
      if (newlyConfirmed.length > 0) {
        void notify({
          eventType: "staffing.assigned",
          createdByUserId: actorId,
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

      for (const b of eligBumps.values()) {
        if (!isLevelAdvance(b.from, b.to)) continue;
        void notifyAdminsOfPromotion({
          userId: b.userId,
          actorId,
          summary: `was promoted to ${b.to} in ${domainNameById.get(b.domainId) ?? "a domain"}`,
        }).catch((err) =>
          console.error(`staffing finalize ${project.id}: promotion notify failed`, err),
        );
      }

      let mentorshipGapNote = "";
      if (mentorshipGaps.length > 0) {
        const menteeIds = [...new Set(mentorshipGaps.flatMap((g) => g.menteeUserIds))];
        const menteeUsers = await prisma.user.findMany({
          where: { id: { in: menteeIds } },
          select: { id: true, firstName: true, lastName: true },
        });
        const nameById = new Map(
          menteeUsers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
        );
        mentorshipGapNote =
          "unpaired: " +
          mentorshipGaps
            .map((g) => {
              const domain = domainNameById.get(g.domainId) ?? "Unknown domain";
              const names = g.menteeUserIds.map((id) => nameById.get(id) ?? id).join(", ");
              return `${domain} (${names})`;
            })
            .join("; ") +
          " — needs a P3/Mentor";
      }

      results.assignments = {
        status: skippedNames.length > 0 ? "error" : "ok",
        message: summarize(
          confirmedCount === 0 && droppedCount === 0
            ? "Nothing proposed"
            : `${confirmedCount} confirmed`,
          droppedCount > 0 && `${droppedCount} removed`,
          pairsCreated > 0 && `${pairsCreated} paired`,
          mentorsPromoted > 0 && `${mentorsPromoted} promoted to P3`,
          skippedNames.length > 0 &&
            `${skippedNames.length} need a domain: ${skippedNames.join(", ")}`,
          mentorshipGapNote,
        ),
      };
    } catch (err) {
      results.assignments = { status: "error", message: slackErrorMessage(err) };
    }
  }

  // ── slack ────────────────────────────────────────────────────────────────────
  if (selected.has("slack")) {
    if (!slackConfigured()) {
      results.slack = { status: "skipped", message: SLACK_NOT_CONFIGURED_MESSAGE };
    } else {
      try {
        const roster = await prisma.staffingAssignment.findMany({
          where: { staffingCycleId: cycle.id, projectId: project.id, status: "Confirmed" },
          select: {
            level: true,
            domainId: true,
            user: { select: SLACK_INVITE_USER_SELECT },
          },
        });
        const [overrideRows, externalRows] = await Promise.all([
          prisma.staffingMentorRole.findMany({
            where: { staffingCycleId: cycle.id },
            select: { userId: true, isMentor: true },
          }),
          prisma.externalMentor.findMany({
            where: { staffingCycleId: cycle.id, projectId: project.id },
            select: { domainId: true, user: { select: { firstName: true, lastName: true } } },
          }),
        ]);
        const overrideByUser = new Map(overrideRows.map((r) => [r.userId, r.isMentor]));
        const domainIds = [
          ...new Set([...roster.map((r) => r.domainId), ...externalRows.map((e) => e.domainId)]),
        ];
        const domainNames = new Map(
          (
            await prisma.domain.findMany({
              where: { id: { in: domainIds } },
              select: { id: true, displayName: true },
            })
          ).map((d) => [d.id, d.displayName]),
        );

        const desiredName = body.slackChannel?.trim() || project.slackChannelName || project.name;
        let channelId = project.slackChannelId;
        let channelNote = `#${desiredName}`;
        const nameChanged = desiredName !== project.slackChannelName;
        if (!channelId || nameChanged) {
          const ch = await ensureChannel(desiredName);
          channelId = ch.id;
          channelNote = ch.created ? `#${ch.name} (new)` : `#${ch.name}`;
          await prisma.project.update({
            where: { id: project.id },
            data: { slackChannelId: channelId, slackChannelName: desiredName },
          });
        }

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
        const inv = await inviteUsersToChannel(channelId!, slackIds);

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
        await postMessage(channelId!, text);

        results.slack = {
          status: "ok",
          message: summarize(
            channelNote,
            `${inv.invited} invited`,
            `${roster.length} announced`,
            missingMembers > 0 && `${missingMembers} no Slack account`,
          ),
        };
      } catch (err) {
        results.slack = { status: "error", message: slackErrorMessage(err) };
      }
    }
  }

  // ── gmail ────────────────────────────────────────────────────────────────────
  if (selected.has("gmail")) {
    if (!workspaceConfigured()) {
      results.gmail = { status: "skipped", message: "Google Workspace provisioning is not configured." };
    } else {
      try {
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
              ? `${group.email}${group.created ? " (new)" : ""}`
              : `group ${group.message}`,
          );
          if (group.status === "ok" && !project.teamGroupEmail) {
            await prisma.project.update({
              where: { id: project.id },
              data: { teamGroupEmail: group.email },
            });
          }
          if (group.status === "ok") {
            const roster = await prisma.staffingAssignment.findMany({
              where: {
                staffingCycleId: cycle.id,
                projectId: project.id,
                status: "Confirmed",
              },
              select: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
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
            parts.push(`${added} added`);
            if (already > 0) parts.push(`${already} already in`);
            if (missing.length > 0) parts.push(`${missing.length} no DALI email: ${missing.join(", ")}`);
            if (memberErrors.length > 0) parts.push(`failed: ${memberErrors.join("; ")}`);
            results.gmail = {
              status: memberErrors.length > 0 ? "error" : "ok",
              message: summarize(...parts),
            };
          }
        }
      } catch (err) {
        results.gmail = { status: "error", message: slackErrorMessage(err) };
      }
    }
  }

  // ── github ───────────────────────────────────────────────────────────────────
  if (selected.has("github")) {
    const slug = body.githubTeamSlug?.trim() || project.githubTeamSlug;
    if (!process.env.GITHUB_ORG) {
      results.github = { status: "skipped", message: "GITHUB_ORG not set." };
    } else if (!slug) {
      results.github = { status: "skipped", message: "No team slug set." };
    } else if (
      (await prisma.project.count({
        where: { id: { not: project.id }, githubTeamSlug: { equals: slug, mode: "insensitive" } },
      })) > 0
    ) {
      results.github = {
        status: "skipped",
        message: `Slug "${slug}" belongs to another project — set a unique one.`,
      };
    } else {
      try {
        const roster = await prisma.staffingAssignment.findMany({
          where: { staffingCycleId: cycle.id, projectId: project.id, status: "Confirmed" },
          select: { user: { select: { firstName: true, lastName: true, githubUsername: true } } },
        });
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
        if (slug !== project.githubTeamSlug) {
          await prisma.project.update({
            where: { id: project.id },
            data: { githubTeamSlug: slug },
          });
        }
        results.github = {
          status: "ok",
          message: summarize(
            `${team.slug}${team.created ? " (new)" : ""}`,
            `${withHandle.size} added`,
            missing.length > 0 && `${missing.length} no GitHub username: ${missing.join(", ")}`,
          ),
        };
      } catch (err) {
        results.github = { status: "error", message: slackErrorMessage(err) };
      }
    }
  }

  await logAuditEvent({
    action: "staffing.finalize",
    userId: actorId,
    targetId: project.id,
    metadata: {
      cycleId: cycle.id,
      automations: Array.from(selected),
      confirmedCount,
      results,
    },
    request,
  });

  publishCycleChange(cycle.id);

  return { results };
}
