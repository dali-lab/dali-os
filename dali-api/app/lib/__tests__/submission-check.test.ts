import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkGitHubUrl, checkFigmaUrl, checkUrl } from "~/lib/submission-check";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
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
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "0044abc123def456789012345678901234567890 refs/heads/main\n" });
    const result = await checkGitHubUrl("https://github.com/dali-lab/dali-os");
    expect(result.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/dali-lab/dali-os.git/info/refs?service=git-upload-pack",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("strips .git suffix before re-adding it", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "0044abc123def456789012345678901234567890 refs/heads/main\n" });
    await checkGitHubUrl("https://github.com/owner/repo.git");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/owner/repo.git/info/refs?service=git-upload-pack",
      expect.anything(),
    );
  });

  it("handles trailing slashes and extra path segments", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "0044abc123def456789012345678901234567890 refs/heads/main\n" });
    await checkGitHubUrl("https://github.com/owner/repo/tree/main/src");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/owner/repo.git/info/refs?service=git-upload-pack",
      expect.anything(),
    );
  });

  it("handles www.github.com", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "0044abc123def456789012345678901234567890 refs/heads/main\n" });
    await checkGitHubUrl("https://www.github.com/owner/repo");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/owner/repo.git/info/refs?service=git-upload-pack",
      expect.anything(),
    );
  });
});

// --------------- GitHub Smart HTTP responses ---------------

describe("checkGitHubUrl — Smart HTTP responses", () => {
  it("returns 'private' on 404", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 403", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("private");
  });

  it("returns 'empty' when response has no refs", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "001e# service=git-upload-pack\n0000" });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("empty");
  });

  it("returns 'valid' when response has refs", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "001e# service=git-upload-pack\n00000044abc123def456789012345678901234567890 refs/heads/main\n",
    });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("valid");
  });

  it("returns 'error' on unexpected status code", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("error");
  });

  it("returns 'error' on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network timeout"));
    const result = await checkGitHubUrl("https://github.com/owner/repo");
    expect(result.status).toBe("error");
    expect(result.message).toContain("network timeout");
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
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "0044abc123def456789012345678901234567890 refs/heads/main\n" });
    const result = await checkUrl("https://github.com/owner/repo");
    expect(result.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("github.com/owner/repo.git/info/refs"),
      expect.anything(),
    );
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
