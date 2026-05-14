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

