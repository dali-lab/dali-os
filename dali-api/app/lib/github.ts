import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

type RepoRef = { owner: string; repo: string };

export function parseRepo(value: string, source: string): RepoRef {
  const [owner, repo] = value.split("/");
  if (!owner || !repo) throw new Error(`${source} must be "owner/repo"`);
  return { owner, repo };
}

function parseRepoEnv(envVal: string | undefined, envName: string): RepoRef {
  if (!envVal) throw new Error(`${envName} is not set`);
  return parseRepo(envVal, envName);
}

// PEM stored in env may have literal "\n" sequences (e.g. Fly secrets via CLI).
// Decode them so the JWT signer sees real newlines.
function decodePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

let cached: Octokit | null = null;
export function githubAppClient(): Octokit {
  if (cached) return cached;
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const pemRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !installationId || !pemRaw) {
    throw new Error("GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY must all be set");
  }
  cached = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: Number(appId),
      privateKey: decodePem(pemRaw),
      installationId: Number(installationId),
    },
  });
  return cached;
}

// Test seam.
export function __setGitHubClientForTests(c: Octokit | null) {
  cached = c;
}

// Create an issue. Defaults to the bug-report repo (GITHUB_ISSUES_REPO) when
// no `repo` is supplied so the existing Slack flow doesn't have to change.
export async function createIssue(args: {
  title: string;
  body: string;
  repo?: string;
}): Promise<{ number: number; htmlUrl: string }> {
  const target = args.repo
    ? parseRepo(args.repo, "createIssue.repo")
    : parseRepoEnv(process.env.GITHUB_ISSUES_REPO, "GITHUB_ISSUES_REPO");
  const res = await githubAppClient().rest.issues.create({
    owner: target.owner,
    repo: target.repo,
    title: args.title,
    body: args.body,
  });
  return { number: res.data.number, htmlUrl: res.data.html_url };
}

// ─── Org teams (staffing finalize) ───────────────────────────────────────────
// These require the GitHub App to have org "Members: write" and to be installed
// on GITHUB_ORG. The org login is read here (not passed in) so callers can't
// target an arbitrary org.

function requireOrg(): string {
  const org = process.env.GITHUB_ORG;
  if (!org) throw new Error("GITHUB_ORG is not set");
  return org;
}

// Get-or-create a team by slug under GITHUB_ORG. Idempotent: an existing team
// is returned untouched (we never recreate or modify its settings on re-run).
// New teams are created `closed` (visible to the org, membership controlled).
export async function ensureTeam(slug: string): Promise<{ slug: string; created: boolean }> {
  const org = requireOrg();
  const gh = githubAppClient();
  try {
    const existing = await gh.rest.teams.getByName({ org, team_slug: slug });
    return { slug: existing.data.slug, created: false };
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  // `name` is what GitHub slugifies; passing the slug as the name keeps the
  // resulting slug stable for a simple input.
  const created = await gh.rest.teams.create({
    org,
    name: slug,
    privacy: "closed",
  });
  return { slug: created.data.slug, created: true };
}

// Add (or confirm) a member on a team. PUT is idempotent — re-adding an
// existing member is a no-op that returns 200. Role defaults to "member".
// Returns the resulting membership state: "pending" when the user isn't yet an
// org member (GitHub emails them an org invite) vs "active" once accepted.
export async function addTeamMember(
  teamSlug: string,
  username: string,
): Promise<{ state: "active" | "pending" }> {
  const org = requireOrg();
  const res = await githubAppClient().rest.teams.addOrUpdateMembershipForUserInOrg({
    org,
    team_slug: teamSlug,
    username,
    role: "member",
  });
  return { state: res?.data?.state === "pending" ? "pending" : "active" };
}

// Grant a team a permission on a repo under GITHUB_ORG. PUT is idempotent —
// re-granting (or changing) the permission overwrites and returns 204. A missing
// repo or team surfaces as 404; callers decide whether to swallow it (isNotFound).
export async function grantTeamRepo(
  teamSlug: string,
  owner: string,
  repo: string,
  permission: "pull" | "triage" | "push" | "maintain" | "admin" = "push",
): Promise<void> {
  const org = requireOrg();
  await githubAppClient().rest.teams.addOrUpdateRepoPermissionsInOrg({
    org,
    team_slug: teamSlug,
    owner,
    repo,
    permission,
  });
}

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: number }).status === 404
  );
}
