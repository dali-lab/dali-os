import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (v) => v ?? null) }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  runGetProjectShowcase,
  runUpdateProjectShowcase,
  ShowcaseNotFoundError,
  ShowcaseForbiddenError,
  ShowcaseInvalidError,
} from "~/mcp/tools/project-showcase";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ME = "user-1";
const PID = "proj-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(true);
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.projectShowcase.upsert.mockResolvedValue({ status: "InProgress" });
});

describe("get_project_showcase", () => {
  it("reports an absent showcase without inventing one", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: PID, name: "CoRisk", showcase: null });
    const out = await runGetProjectShowcase(ME, { projectId: PID });
    expect(out).toMatchObject({
      exists: false,
      status: null,
      liveOnWebsite: false,
      tagline: null,
      products: [],
    });
  });

  it("flags liveOnWebsite only for Published", async () => {
    const base = { id: PID, name: "CoRisk" };
    mockPrisma.project.findUnique.mockResolvedValue({
      ...base,
      showcase: { status: "NeedsReview", products: [], sectors: [], techStack: [], partners: [] },
    });
    expect((await runGetProjectShowcase(ME, { projectId: PID })).liveOnWebsite).toBe(false);

    mockPrisma.project.findUnique.mockResolvedValue({
      ...base,
      showcase: { status: "Published", products: [], sectors: [], techStack: [], partners: [] },
    });
    expect((await runGetProjectShowcase(ME, { projectId: PID })).liveOnWebsite).toBe(true);
  });

  it("404s on an unknown project", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(runGetProjectShowcase(ME, { projectId: "nope" })).rejects.toThrow(
      ShowcaseNotFoundError,
    );
  });
});

describe("update_project_showcase permissions", () => {
  beforeEach(() => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: PID, name: "CoRisk", showcase: null });
  });

  it("lets a staffed member edit content", async () => {
    const res = await runUpdateProjectShowcase(ME, { projectId: PID, tagline: "A thing" });
    expect(res).toMatchObject({ ok: true, created: true });
  });

  it("refuses someone neither Core nor on the project", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runUpdateProjectShowcase(ME, { projectId: PID, tagline: "x" }),
    ).rejects.toThrow(ShowcaseForbiddenError);
  });

  it("refuses a status change from a non-Core member, even one on the project", async () => {
    // Publishing is what puts the project in front of the public.
    await expect(
      runUpdateProjectShowcase(ME, { projectId: PID, status: "Published", confirmed: true }),
    ).rejects.toThrow(/Only Core or Admin/);
    expect(mockPrisma.projectShowcase.upsert).not.toHaveBeenCalled();
  });
});

describe("update_project_showcase status gate", () => {
  beforeEach(() => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({
      id: PID,
      name: "CoRisk",
      showcase: { status: "InProgress" },
    });
  });

  it("previews a status change instead of applying it", async () => {
    const res = await runUpdateProjectShowcase(ME, { projectId: PID, status: "Published" });
    expect(res.ok).toBe(false);
    expect((res as any).preview).toMatchObject({
      statusFrom: "InProgress",
      statusTo: "Published",
      goesLive: true,
    });
    expect(mockPrisma.projectShowcase.upsert).not.toHaveBeenCalled();
  });

  it("applies once confirmed, and audits it", async () => {
    mockPrisma.projectShowcase.upsert.mockResolvedValue({ status: "Published" });
    const res = await runUpdateProjectShowcase(ME, {
      projectId: PID,
      status: "Published",
      confirmed: true,
    });
    expect(res).toMatchObject({ ok: true, status: "Published" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "project.showcase-status" }),
    );
  });

  it("does not gate content-only edits", async () => {
    // Gating every field would make the tool useless for the drafting it exists for.
    const res = await runUpdateProjectShowcase(ME, { projectId: PID, tagline: "Draft" });
    expect(res.ok).toBe(true);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("update_project_showcase field handling", () => {
  beforeEach(() => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: PID, name: "CoRisk", showcase: null });
  });

  it("clears a text field on an empty string and leaves omitted fields alone", async () => {
    await runUpdateProjectShowcase(ME, { projectId: PID, tagline: "", displayName: "Pub" });
    const data = mockPrisma.projectShowcase.upsert.mock.calls[0][0].update;
    expect(data.tagline).toBeNull();
    expect(data.displayName).toBe("Pub");
    expect(data).not.toHaveProperty("year");
    expect(data).not.toHaveProperty("status");
  });

  it("rejects an out-of-range year", async () => {
    await expect(
      runUpdateProjectShowcase(ME, { projectId: PID, year: 1200 }),
    ).rejects.toThrow(ShowcaseInvalidError);
  });

  it("rejects a call with nothing to change", async () => {
    await expect(runUpdateProjectShowcase(ME, { projectId: PID })).rejects.toThrow(
      /No fields to update/,
    );
  });
});
