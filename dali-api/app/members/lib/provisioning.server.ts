import { prisma } from "~/lib/db";
import { ensureTeam, addTeamMember, isNo2fa } from "~/lib/github";
import { inviteToWorkspace } from "~/slack/lib/slack-client";
import { provisionWorkspaceAccount, type WorkspaceResult } from "~/lib/google-workspace";
import { syncSlackUserId } from "~/members/lib/slack-sync.server";

// Best-effort external provisioning for a newly-accepted member. Each step is
// isolated and idempotent; a failure in one never blocks the others or the
// acceptance that triggered it. Returns a per-integration status summary the
// caller records on the audit event.
//
// Order matters: the Workspace account (the member's @dali.dartmouth.edu email)
// is created FIRST, because the Slack invite and the welcome email both target
// that address. Steps that need it are skipped if Workspace isn't configured.
//
// Steps:
//   - workspace: create the @dali.dartmouth.edu Google account (Admin SDK).
//   - slack:     invite that email to the workspace (admin token) + announce.
//   - github:    add the member's GitHub handle to their domain's org team.

type StepStatus = { status: "ok" | "skipped" | "error"; message: string };
export type ProvisionResult = {
  workspace: StepStatus;
  slack: StepStatus;
  github: StepStatus;
  // The provisioned DALI email, when Workspace ran — so callers (welcome email)
  // can tell the member which address to log in with.
  daliEmail: string | null;
  // The one-time temporary password Workspace generated for a NEWLY-created
  // account (forced change at first login). Surfaced so the onboarding email can
  // give the member their initial credential — null when the account already
  // existed or Workspace didn't run. SECURITY: this is a live credential. It
  // must reach ONLY the onboarding email; callers MUST exclude it from audit
  // logs / console output (see api.decisions.$id.release).
  daliTempPassword: string | null;
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Org team slug for a domain. Domains don't carry a githubTeamSlug column (only
// Projects do), so derive a stable slug from the domain's code/name.
function domainTeamSlug(domain: { code?: string | null; name: string }): string {
  const base = (domain.code ?? domain.name).toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function toStep(w: WorkspaceResult): StepStatus {
  if (w.status === "ok") {
    return { status: "ok", message: `${w.created ? "Created" : "Exists"}: ${w.email}` };
  }
  return { status: w.status, message: w.message };
}

export async function provisionNewMember(args: {
  userId: string;
  domainId: string;
}): Promise<ProvisionResult> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      firstName: true,
      lastName: true,
      githubUsername: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  const domain = await prisma.domain.findUnique({
    where: { id: args.domainId },
    select: { name: true, displayName: true, code: true },
  });

  const result: ProvisionResult = {
    workspace: { status: "skipped", message: "" },
    slack: { status: "skipped", message: "" },
    github: { status: "skipped", message: "" },
    daliEmail: user?.daliEmail ?? null,
    daliTempPassword: null,
  };

  // ── workspace: create the @dali.dartmouth.edu account ───────────────────
  let daliEmail = user?.daliEmail ?? null;
  if (user) {
    const w = await provisionWorkspaceAccount({
      firstName: user.firstName,
      lastName: user.lastName,
      recoveryEmail: user.dartmouthEmail,
    });
    result.workspace = toStep(w);
    if (w.status === "ok") {
      daliEmail = w.email;
      result.daliEmail = w.email;
      // Only present when the account was just created (not on "already exists").
      result.daliTempPassword = w.tempPassword ?? null;
      // Persist the new DALI email onto the User so login + future flows use it.
      if (!user.daliEmail || user.daliEmail !== w.email) {
        try {
          await prisma.user.update({
            where: { id: args.userId },
            data: { daliEmail: w.email },
          });
        } catch {
          // A unique-collision here shouldn't fail provisioning; leave as-is.
        }
      }
    }
  }

  // ── slack: invite the new member to the workspace + sync slackUserId ─────
  // admin.users.invite (inviteToWorkspace) needs an admin token we don't have,
  // so this call returns "skipped"; a teammate adds the member to the workspace
  // by hand (the onboarding email tells them to expect that). We still attempt it
  // (harmless no-op when unconfigured) and still sync the member's Slack id when
  // possible so later per-project channel invites can add them by id.
  try {
    const parts: string[] = [];
    if (daliEmail) {
      // No channel passed → inviteToWorkspace defaults to #general.
      const inv = await inviteToWorkspace(daliEmail, []);
      parts.push(`invite: ${inv.message}`);
    } else {
      parts.push("invite: skipped (no DALI email)");
    }
    // Resolve + store the member's Slack user id so per-project channel invites
    // (staffing finalize) can add them by id later.
    const sync = await syncSlackUserId(args.userId);
    parts.push(`slack id: ${sync.status}`);
    result.slack = { status: "ok", message: parts.join("; ") };
  } catch (err) {
    result.slack = { status: "error", message: errMsg(err) };
  }

  // ── github: add member to their domain's org team ───────────────────────
  if (!process.env.GITHUB_ORG) {
    result.github = { status: "skipped", message: "GITHUB_ORG not set." };
  } else if (!user?.githubUsername?.trim()) {
    result.github = { status: "skipped", message: "Member has no GitHub username yet." };
  } else if (!domain) {
    result.github = { status: "skipped", message: "Domain not found." };
  } else {
    try {
      const team = await ensureTeam(domainTeamSlug(domain));
      await addTeamMember(team.slug, user.githubUsername.trim());
      result.github = {
        status: "ok",
        message: `Added ${user.githubUsername.trim()} to team "${team.slug}".`,
      };
    } catch (err) {
      result.github = {
        status: "error",
        message: isNo2fa(err)
          ? "Member must enable two-factor auth on GitHub before they can join the org."
          : errMsg(err),
      };
    }
  }

  return result;
}
