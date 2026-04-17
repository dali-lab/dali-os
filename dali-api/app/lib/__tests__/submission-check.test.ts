import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkGitHubUrl, checkFigmaUrl, checkUrl } from "~/lib/submission-check";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

import { execFile } from "node:child_process";
const execFileMock = vi.mocked(execFile);

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  execFileMock.mockReset();
});

// --------------- GitHub URL parsing ---------------

describe("checkGitHubUrl — URL parsing", () => {
  it("rejects a non-GitHub URL", async () => {
    const result = await checkGitHubUrl("https://example.com/foo/bar");
    expect(result.status).toBe("invalid_url");
  });

  it("rejects a GitHub URL without owner/repo", async () => {
    const result = await checkGitHubUrl("https://github.com/only-owner");
    expect(result.status).toBe("invalid_url");
  });

  it("rejects a malformed URL", async () => {
    const result = await checkGitHubUrl("not-a-url");
    expect(result.status).toBe("invalid_url");
  });

  it("accepts a standard GitHub repo URL", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "abc123\trefs/heads/main\n", stderr: "" });
    const result = await checkGitHubUrl("https://github.com/dali-lab/dali-os");
    expect(result.status).toBe("valid");
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "https://github.com/dali-lab/dali-os.git"],
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it("strips .git suffix before re-adding it", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "abc123\trefs/heads/main\n", stderr: "" });
    await checkGitHubUrl("https://github.com/owner/repo.git");
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "https://github.com/owner/repo.git"],
      expect.anything(),
    );
  });

  it("handles trailing slashes and extra path segments", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "abc123\trefs/heads/main\n", stderr: "" });
    await checkGitHubUrl("https://github.com/owner/repo/tree/main/src");
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "https://github.com/owner/repo.git"],
      expect.anything(),
    );
  });

  it("handles www.github.com", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "abc123\trefs/heads/main\n", stderr: "" });
    await checkGitHubUrl("https://www.github.com/owner/repo");
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "https://github.com/owner/repo.git"],
      expect.anything(),
    );
  });
});

// --------------- GitHub git ls-remote responses ---------------

describe("checkGitHubUrl — git ls-remote responses", () => {
  it("returns 'private' when git ls-remote fails with 'not found'", async () => {
    execFileMock.mockRejectedValueOnce(new Error("fatal: remote error: Repository not found."));
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("private");
  });

  it("returns 'private' when git ls-remote exits with code 128", async () => {
    execFileMock.mockRejectedValueOnce(new Error("exit code 128"));
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("private");
  });

  it("returns 'empty' when stdout is empty", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("empty");
  });

  it("returns 'empty' when stdout is only whitespace", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "  \n  ", stderr: "" });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("empty");
  });

  it("returns 'valid' when stdout has refs", async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: "abc123def456\trefs/heads/main\n789abc\trefs/tags/v1.0\n",
      stderr: "",
    });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("valid");
  });

  it("returns 'error' on unexpected failure", async () => {
    execFileMock.mockRejectedValueOnce(new Error("git: command not found"));
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("error");
    expect(result.message).toContain("git: command not found");
  });
});

// --------------- Figma URL parsing ---------------

describe("checkFigmaUrl — URL parsing", () => {
  it("rejects a non-Figma URL", async () => {
    const result = await checkFigmaUrl("https://example.com/file/abc123/name");
    expect(result.status).toBe("invalid_url");
  });

  it("rejects a Figma URL without file key", async () => {
    const result = await checkFigmaUrl("https://figma.com/file");
    expect(result.status).toBe("invalid_url");
  });

  it("accepts a /file/ URL and fetches the page directly", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkFigmaUrl("https://figma.com/file/abc123/My-Design");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.figma.com/file/abc123",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("accepts a /design/ URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkFigmaUrl("https://figma.com/design/xyz789/Another-File");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.figma.com/file/xyz789",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("handles www.figma.com", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkFigmaUrl("https://www.figma.com/file/key1/Name");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.figma.com/file/key1",
      expect.anything(),
    );
  });
});

// --------------- Figma page fetch responses ---------------

describe("checkFigmaUrl — page fetch responses", () => {
  const url = "https://figma.com/file/abc123/Design";

  it("returns 'private' on redirect (302)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 302 });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 301 redirect", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 301 });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 403", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 404", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'valid' on 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("valid");
  });

  it("returns 'error' on unexpected status code", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("error");
  });

  it("returns 'error' on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("error");
    expect(result.message).toContain("timeout");
  });
});

// --------------- Convenience wrapper ---------------

describe("checkUrl", () => {
  it("routes GitHub URLs to checkGitHubUrl", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "abc\trefs/heads/main\n", stderr: "" });
    const result = await checkUrl("https://github.com/owner/repo");
    expect(result.status).toBe("valid");
    expect(execFileMock).toHaveBeenCalled();
  });

  it("routes Figma URLs to checkFigmaUrl", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await checkUrl("https://figma.com/file/key/Name");
    expect(result.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("www.figma.com"),
      expect.anything(),
    );
  });

  it("returns invalid_url for unrecognized URLs", async () => {
    const result = await checkUrl("https://example.com/portfolio");
    expect(result.status).toBe("invalid_url");
  });
});
