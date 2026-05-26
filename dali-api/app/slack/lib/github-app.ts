import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

type RepoRef = { owner: string; repo: string };

function parseRepo(envVal: string | undefined, envName: string): RepoRef {
  if (!envVal) throw new Error(`${envName} is not set`);
  const [owner, repo] = envVal.split("/");
  if (!owner || !repo) throw new Error(`${envName} must be "owner/repo"`);
  return { owner, repo };
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

export async function createIssue(args: { title: string; body: string }): Promise<{
  number: number;
  htmlUrl: string;
}> {
  const target = parseRepo(process.env.GITHUB_ISSUES_REPO, "GITHUB_ISSUES_REPO");
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
export async function addTeamMember(teamSlug: string, username: string): Promise<void> {
  const org = requireOrg();
  await githubAppClient().rest.teams.addOrUpdateMembershipForUserInOrg({
    org,
    team_slug: teamSlug,
    username,
    role: "member",
  });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: number }).status === 404
  );
}

