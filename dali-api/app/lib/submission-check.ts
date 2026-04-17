import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SubmissionCheckResult = {
  status: "valid" | "private" | "empty" | "invalid_url" | "error";
  url: string;
  message: string;
};

/**
 * extract owner/repo from a GitHub URL.
 * supports: github.com/{owner}/{repo}[.git][/...]
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "github.com" &&
      parsed.hostname !== "www.github.com"
    ) {
      return null;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

/**
 * extract file key from a Figma URL.
 * supports: figma.com/file/{key}/... and figma.com/design/{key}/...
 */
function parseFigmaUrl(url: string): { fileKey: string } | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "figma.com" &&
      parsed.hostname !== "www.figma.com"
    ) {
      return null;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    if (segments[0] !== "file" && segments[0] !== "design") return null;
    const fileKey = segments[1];
    if (!fileKey) return null;
    return { fileKey };
  } catch {
    return null;
  }
}

/**
 * check whether a GitHub repo URL points to a public, non-empty repository
 * uses `git ls-remote` to check for repo existence and content without cloning.
 */
export async function checkGitHubUrl(
  url: string,
): Promise<SubmissionCheckResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return {
      status: "invalid_url",
      url,
      message: "Not a valid GitHub repository URL",
    };
  }

  const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;

  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", repoUrl], {
      timeout: 15_000,
    });

    if (stdout.trim().length === 0) {
      return {
        status: "empty",
        url,
        message: "Repository exists but is empty",
      };
    }

    return {
      status: "valid",
      url,
      message: "Repository is public and has content",
    };
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (
      message.includes("Repository not found") ||
      message.includes("exit code 128")
    ) {
      return {
        status: "private",
        url,
        message: "Repository is private or does not exist",
      };
    }
    return {
      status: "error",
      url,
      message: `Failed to check GitHub repo: ${message}`,
    };
  }
}

/**
 * check whether a Figma file URL points to an accessible file by fetching the page directly.
 * does not check if the file has content, possible TODO later
 * (complex to do without api access)
 */
export async function checkFigmaUrl(
  url: string,
): Promise<SubmissionCheckResult> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    return {
      status: "invalid_url",
      url,
      message: "Not a valid Figma file URL",
    };
  }

  const pageUrl = `https://www.figma.com/file/${parsed.fileKey}`;

  try {
    const res = await fetch(pageUrl, { redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      return {
        status: "private",
        url,
        message: "Figma file is private (redirects to login)",
      };
    }

    if (res.status === 403 || res.status === 404) {
      return {
        status: "private",
        url,
        message: "Figma file is private or does not exist",
      };
    }

    if (!res.ok) {
      return { status: "error", url, message: `Figma returned ${res.status}` };
    }

    return {
      status: "valid",
      url,
      message: "Figma file is publicly accessible",
    };
  } catch (err) {
    return {
      status: "error",
      url,
      message: `Failed to reach Figma: ${(err as Error).message}`,
    };
  }
}

/**
 * convenience wrapper that detects the URL type and calls the correct check function.
 */
export async function checkUrl(url: string): Promise<SubmissionCheckResult> {
  if (parseGitHubUrl(url)) {
    return checkGitHubUrl(url);
  }

  if (parseFigmaUrl(url)) {
    return checkFigmaUrl(url);
  }

  return {
    status: "invalid_url",
    url,
    message: "URL is not a recognized GitHub or Figma link",
  };
}
