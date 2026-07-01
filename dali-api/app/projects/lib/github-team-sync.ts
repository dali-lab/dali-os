import { prisma } from "~/lib/db";
import { ensureTeam, addTeamMember, grantTeamRepo, isNotFound } from "~/lib/github";
import { normalizeRepo } from "~/projects/lib/github-task-sync";
import { currentTerm } from "~/lib/roles";
import { slackErrorMessage } from "~/slack/lib/slack-client";

// Add-only, idempotent sync of ONE project's current-term roster into its GitHub
// org team, plus a push grant for each of its repos. Never lists or removes
// members/repos (add-only per design — departures are handled by org-level
// offboarding). Safe to re-run: ensureTeam get-or-creates, addTeamMember PUTs,
// grantTeamRepo PUTs. Per-member and per-repo failures are isolated so one bad
// handle or repo never aborts the rest — the whole thing converges on re-run.

export type RepoSyncResult = {
  repo: string; // "owner/repo", or the raw entry when unparseable
  status: "granted" | "skipped" | "error";
  message?: string;
};

export type MemberError = { handle: string; message: string };

export type ProjectTeamSyncReport = {
  projectId: string;
  projectName: string;
  status: "ok" | "skipped" | "error";
  slug: string | null;
  teamCreated: boolean;
  membersEnsured: number; // handles PUT to the team (idempotent — "ensured", not "newly added")
  membersPending: number; // subset returned state:"pending" (GitHub emailed an org invite)
  missingHandles: string[]; // rostered member display names with no githubUsername (reported, not skipped silently)
  memberErrors: MemberError[];
  repos: RepoSyncResult[];
  message: string;
};

function emptyReport(
  projectId: string,
  projectName: string,
  slug: string | null,
  status: ProjectTeamSyncReport["status"],
  message: string,
): ProjectTeamSyncReport {
  return {
    projectId,
    projectName,
    status,
    slug,
    teamCreated: false,
    membersEnsured: 0,
    membersPending: 0,
    missingHandles: [],
    memberErrors: [],
    repos: [],
    message,
  };
}

export async function syncProjectTeam(
  projectId: string,
  termId?: string,
): Promise<ProjectTeamSyncReport> {
  let tid = termId;
  if (!tid) {
    const t = await currentTerm();
    if (!t) return emptyReport(projectId, projectId, null, "skipped", "No current term.");
    tid = t.id;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      githubTeamSlug: true,
      repoUrls: true,
      // Project.assignments == ProjectAssignment (live, term-scoped roster).
      assignments: {
        where: { termId: tid },
        select: {
          user: { select: { id: true, firstName: true, lastName: true, githubUsername: true } },
        },
      },
    },
  });
  if (!project) return emptyReport(projectId, projectId, null, "skipped", "Project not found.");

  const slug = project.githubTeamSlug?.trim() || null;
  if (!slug) {
    return emptyReport(
      project.id,
      project.name,
      null,
      "skipped",
      "No GitHub team slug — set one on the project page.",
    );
  }

  // Desired member set: dedupe by user id (a user holds one ProjectAssignment
  // row per domain). Strip a stray leading "@" so a stored "@foo" doesn't error.
  const byUser = new Map<string, { name: string; handle: string | null }>();
  for (const a of project.assignments) {
    byUser.set(a.user.id, {
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      handle: a.user.githubUsername?.trim().replace(/^@/, "") || null,
    });
  }
  const members = [...byUser.values()];
  const handles = [...new Set(members.map((m) => m.handle).filter((h): h is string => !!h))];
  const missingHandles = members.filter((m) => !m.handle).map((m) => m.name);

  const report = emptyReport(project.id, project.name, slug, "ok", "");
  report.missingHandles = missingHandles;

  // ensureTeam is the only project-fatal step — without a team nothing else can proceed.
  let team: { slug: string; created: boolean };
  try {
    team = await ensureTeam(slug);
  } catch (err) {
    return { ...report, status: "error", message: slackErrorMessage(err) };
  }
  report.slug = team.slug;
  report.teamCreated = team.created;

  // Members — sequential (avoids GitHub secondary-rate-limit bursts), isolated.
  for (const handle of handles) {
    try {
      const { state } = await addTeamMember(team.slug, handle);
      report.membersEnsured += 1;
      if (state === "pending") report.membersPending += 1;
    } catch (err) {
      report.memberErrors.push({ handle, message: slackErrorMessage(err) });
    }
  }

  // Repos — per-repo isolation; unparseable entries are "skipped", not errors.
  for (const raw of project.repoUrls ?? []) {
    const norm = normalizeRepo(raw);
    if (!norm) {
      report.repos.push({ repo: raw, status: "skipped", message: "Not a parseable owner/repo." });
      continue;
    }
    const [owner, repo] = norm.split("/");
    try {
      await grantTeamRepo(team.slug, owner, repo, "push");
      report.repos.push({ repo: norm, status: "granted" });
    } catch (err) {
      report.repos.push({
        repo: norm,
        status: "error",
        message: isNotFound(err)
          ? `${norm}: not found — check the repo exists in the org and the App has access.`
          : slackErrorMessage(err),
      });
    }
  }

  const failed = report.memberErrors.length > 0 || report.repos.some((r) => r.status === "error");
  report.status = failed ? "error" : "ok";
  report.message = summarize(report);
  return report;
}

function summarize(r: ProjectTeamSyncReport): string {
  const parts = [
    `${r.teamCreated ? "created" : "found"} team "${r.slug}"`,
    `ensured ${r.membersEnsured} member${r.membersEnsured === 1 ? "" : "s"}${
      r.membersPending ? ` (${r.membersPending} pending invite)` : ""
    }`,
  ];
  const granted = r.repos.filter((x) => x.status === "granted").length;
  parts.push(`granted ${granted} repo${granted === 1 ? "" : "s"}`);
  if (r.missingHandles.length) {
    parts.push(`${r.missingHandles.length} without a GitHub username (${r.missingHandles.join(", ")})`);
  }
  if (r.memberErrors.length) {
    parts.push(`${r.memberErrors.length} member error${r.memberErrors.length === 1 ? "" : "s"}`);
  }
  const repoProblems = r.repos.filter((x) => x.status === "error").length;
  if (repoProblems) parts.push(`${repoProblems} repo error${repoProblems === 1 ? "" : "s"}`);
  return `${parts.join("; ")}.`;
}
