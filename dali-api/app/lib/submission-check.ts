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
function parseFigmaUrl(url: string): { fileKey: string; pathSegment: string } | null {
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
    return { fileKey, pathSegment: segments[0] };
  } catch {
    return null;
  }
}

/**
 * check whether a GitHub repo URL points to a public, non-empty repository
 * uses the Git Smart HTTP protocol to list refs without needing the git binary.
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

  const refsUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git/info/refs?service=git-upload-pack`;

  try {
    const res = await fetch(refsUrl, { signal: AbortSignal.timeout(15_000) });

    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        status: "private",
        url,
        message: "Repository is private or does not exist",
      };
    }

    if (!res.ok) {
      return { status: "error", url, message: `GitHub returned ${res.status}` };
    }

    const body = await res.text();

    // The response contains pkt-line formatted refs.
    // Non-empty repos have lines with 40-char hex SHAs (e.g. "004477319e2a... HEAD")
    // An empty repo has only the service header and a flush packet.
    if (!/[0-9a-f]{40}/.test(body)) {
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
    return {
      status: "error",
      url,
      message: `Failed to check GitHub repo: ${(err as Error).message}`,
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

  const pageUrl = `https://www.figma.com/${parsed.pathSegment}/${parsed.fileKey}`;

  try {
    const res = await fetch(pageUrl, { redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      if (!location) {
        return { status: "private", url, message: "Figma file is private (redirects to login)" };
      }
      try {
        const dest = new URL(location, pageUrl);
        const isFigma = dest.hostname === "figma.com" || dest.hostname === "www.figma.com";
        const isLogin = dest.pathname.startsWith("/login");
        if (isFigma && !isLogin) {
          return { status: "valid", url, message: "Figma file is publicly accessible" };
        }
      } catch {
        // malformed location header — fall through to private
      }
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
