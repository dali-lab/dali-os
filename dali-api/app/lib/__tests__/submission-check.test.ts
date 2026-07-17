import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkGitHubUrl, checkFigmaUrl, checkDriveUrl, checkUrl } from "~/lib/submission-check";

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

  it("accepts a /design/ URL and preserves path segment", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkFigmaUrl("https://figma.com/design/xyz789/Another-File");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.figma.com/design/xyz789",
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

  it("returns 'valid' when redirect stays on figma.com (canonical rewrite)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://www.figma.com/design/abc123/Design" }),
    });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("valid");
  });

  it("returns 'private' when redirect goes to figma login", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://www.figma.com/login?redirect_uri=..." }),
    });
    const result = await checkFigmaUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'private' on redirect with no location header", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 301,
      headers: new Headers(),
    });
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

// --------------- Drive URL parsing ---------------

describe("checkDriveUrl — URL parsing", () => {
  it("rejects a non-Google URL", async () => {
    const result = await checkDriveUrl("https://example.com/file/d/abc/view");
    expect(result.status).toBe("invalid_url");
  });

  it("rejects a malformed URL", async () => {
    const result = await checkDriveUrl("not-a-url");
    expect(result.status).toBe("invalid_url");
  });

  it("rejects a Drive URL without a file id", async () => {
    const result = await checkDriveUrl("https://drive.google.com/file/d/");
    expect(result.status).toBe("invalid_url");
  });

  it("rejects a docs.google.com URL with an unknown product segment", async () => {
    const result = await checkDriveUrl("https://docs.google.com/widget/d/abc/view");
    expect(result.status).toBe("invalid_url");
  });

  it("accepts a Drive /file/d/ URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkDriveUrl("https://drive.google.com/file/d/abc123/view?usp=sharing");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://drive.google.com/file/d/abc123/view",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("accepts a Drive /drive/folders/ URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkDriveUrl("https://drive.google.com/drive/folders/folder789?usp=share_link");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://drive.google.com/drive/folders/folder789",
      expect.anything(),
    );
  });

  it("accepts a Google Doc URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkDriveUrl("https://docs.google.com/document/d/docKey/edit");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://docs.google.com/document/d/docKey/edit",
      expect.anything(),
    );
  });

  it("accepts a Google Sheet URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkDriveUrl("https://docs.google.com/spreadsheets/d/sheetKey/edit#gid=0");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/sheetKey/edit",
      expect.anything(),
    );
  });

  it("accepts a Google Slides URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkDriveUrl("https://docs.google.com/presentation/d/slidesKey/edit");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://docs.google.com/presentation/d/slidesKey/edit",
      expect.anything(),
    );
  });

  it("handles www.drive.google.com", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkDriveUrl("https://www.drive.google.com/file/d/abc/view");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://drive.google.com/file/d/abc/view",
      expect.anything(),
    );
  });
});

// --------------- Drive page fetch responses ---------------

describe("checkDriveUrl — page fetch responses", () => {
  const url = "https://drive.google.com/file/d/abc123/view";

  it("returns 'private' when redirect goes to accounts.google.com", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://accounts.google.com/ServiceLogin?continue=..." }),
    });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'valid' when redirect stays within drive.google.com", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://drive.google.com/file/d/abc123/preview" }),
    });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("valid");
  });

  it("returns 'private' on redirect with no location header", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 301,
      headers: new Headers(),
    });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 403", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'private' on 404", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("private");
  });

  it("returns 'valid' on 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("valid");
  });

  it("returns 'error' on unexpected status code", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await checkDriveUrl(url);
    expect(result.status).toBe("error");
  });

  it("returns 'error' on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const result = await checkDriveUrl(url);
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

  it("routes Drive URLs to checkDriveUrl", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await checkUrl("https://drive.google.com/file/d/abc/view");
    expect(result.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("drive.google.com/file/d/abc"),
      expect.anything(),
    );
  });

  it("routes Google Docs URLs to checkDriveUrl", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await checkUrl("https://docs.google.com/document/d/abc/edit");
    expect(result.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("docs.google.com/document/d/abc"),
      expect.anything(),
    );
  });

  it("returns invalid_url for unrecognized URLs", async () => {
    const result = await checkUrl("https://example.com/portfolio");
    expect(result.status).toBe("invalid_url");
  });
});
