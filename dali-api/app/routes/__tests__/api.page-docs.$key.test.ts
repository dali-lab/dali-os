import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(async (k: string) => `https://s3.example.edu/${k}`),
  isS3Configured: vi.fn(() => true),
}));
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({ ensureBlocks: (x: unknown) => x }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/mentions", () => ({
  extractMentionUserIds: (body: any) => (Array.isArray(body) ? body.flatMap((b: any) => b.mentions ?? []) : []),
  notifyMentions: vi.fn().mockResolvedValue(undefined),
  pageDocLink: (p?: string) => `link:${p ?? ""}`,
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore, isLabMember } from "~/lib/roles";
import { isS3Configured } from "~/lib/s3";
import { notify } from "~/lib/notify.server";
import { notifyMentions } from "~/lib/mentions";
import { action, loader } from "~/routes/api.page-docs.$key";

const m = prisma as any;

const get = (qs = "") =>
  loader({
    request: new Request(`http://localhost/api/page-docs/tasks${qs}`),
    params: { key: "tasks" },
  } as any) as Promise<Response>;

const post = (body: unknown, method = "POST") =>
  action({
    request: new Request("http://localhost/api/page-docs/tasks", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    params: { key: "tasks" },
  } as any) as Promise<Response>;

const EXISTING = {
  id: "doc1",
  body: null,
  videoKey: null,
  sections: [{ id: "s1", title: "Intro", body: [{ mentions: ["old"] }], videoKey: "vid/1" }],
  maintainerId: "grace",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isS3Configured).mockReturnValue(true);
  m.pageDoc = {
    upsert: vi.fn().mockResolvedValue({
      id: "doc1",
      title: "Tasks",
      body: null,
      videoKey: null,
      sections: null,
      maintainerId: "grace",
      maintainer: { id: "grace", firstName: "Grace", lastName: "Hopper", handle: "grace" },
    }),
    findUnique: vi.fn().mockResolvedValue(EXISTING),
    update: vi.fn().mockResolvedValue({ id: "doc1", title: "Tasks" }),
  };
});

describe("loader", () => {
  it("returns the auth failure and forbids non-lab-members", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);
    expect((await get()).status).toBe(401);
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect(m.pageDoc.upsert).not.toHaveBeenCalled();
  });

  it("creates the guide on first view with the ?title or the key, never overwriting an existing one", async () => {
    await get("?title=%20Task%20board%20");
    expect(m.pageDoc.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pageKey: "tasks" },
        update: {},
        create: { pageKey: "tasks", title: "Task board", createdById: "ada" },
      }),
    );
    await get();
    expect(m.pageDoc.upsert.mock.calls[1][0].create.title).toBe("tasks");
  });

  it("lets only Core or the maintainer edit, and only Core assign the maintainer", async () => {
    let body = await (await get()).json();
    expect(body).toMatchObject({ canEdit: false, canAssignMaintainer: false, currentUserId: "ada" });

    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "grace" } } as never);
    body = await (await get()).json();
    expect(body).toMatchObject({ canEdit: true, canAssignMaintainer: false });

    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
    body = await (await get()).json();
    expect(body).toMatchObject({ canEdit: true, canAssignMaintainer: true });
  });

  it("falls back to a single Overview section from legacy columns and signs video urls", async () => {
    m.pageDoc.upsert.mockResolvedValue({
      id: "doc1",
      title: "Tasks",
      body: [{ t: 1 }],
      videoKey: "vid/legacy",
      sections: null,
      maintainerId: null,
      maintainer: null,
    });
    const body = await (await get()).json();
    expect(body.maintainer).toBeNull();
    expect(body.doc.sections).toEqual([
      {
        id: "overview",
        title: "Overview",
        body: [{ t: 1 }],
        videoUrl: "https://s3.example.edu/vid/legacy",
        hasVideo: true,
      },
    ]);
    expect(body.doc.videoUrl).toBe("https://s3.example.edu/vid/legacy");
    expect(body.doc.hasVideo).toBe(true);
  });

  it("omits video urls when S3 is not configured but still reports hasVideo", async () => {
    vi.mocked(isS3Configured).mockReturnValue(false);
    m.pageDoc.upsert.mockResolvedValue({
      id: "doc1",
      title: "Tasks",
      body: null,
      videoKey: "vid/legacy",
      sections: null,
      maintainerId: null,
      maintainer: null,
    });
    const body = await (await get()).json();
    expect(body.doc.videoUrl).toBeNull();
    expect(body.doc.hasVideo).toBe(true);
  });

  it("names the maintainer", async () => {
    const body = await (await get()).json();
    expect(body.maintainer).toEqual({ id: "grace", name: "Grace Hopper", handle: "grace" });
  });
});

describe("action access", () => {
  it("returns the auth failure, rejects non-POST, and forbids non-lab-members", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);
    expect((await post({ title: "x" })).status).toBe(401);
    expect((await post({}, "GET")).status).toBe(405);
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect((await post({ title: "x" })).status).toBe(403);
    expect(m.pageDoc.update).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    expect((await post({ title: "   " })).status).toBe(400);
    expect((await post({ title: "a".repeat(201) })).status).toBe(400);
    expect((await post({ sections: "nope" })).status).toBe(400);
  });

  it("404s when the guide does not exist yet", async () => {
    m.pageDoc.findUnique.mockResolvedValue(null);
    expect((await post({ title: "x" })).status).toBe(404);
  });

  it("forbids content edits from a plain lab member", async () => {
    for (const body of [
      { title: "x" },
      { body: [] },
      { videoKey: null },
      { sections: [{ title: "A" }] },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(403);
    }
    expect(m.pageDoc.update).not.toHaveBeenCalled();
  });

  it("lets the maintainer edit content but not reassign the maintainer", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "grace" } } as never);
    expect((await post({ title: "New" })).status).toBe(200);
    const res = await post({ maintainerId: "ada" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Core can assign the maintainer." });
  });

  it("lets a non-maintainer send the unchanged maintainerId without being blocked", async () => {
    const res = await post({ maintainerId: "grace" });
    expect(res.status).toBe(200);
    expect(m.pageDoc.update.mock.calls[0][0].data).toEqual({ lastEditedById: "ada" });
  });

  it("Core may assign a maintainer, who must be a lab member", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isLabMember).mockImplementation(async (id: string) => id !== "outsider");
    const bad = await post({ maintainerId: "outsider" });
    expect(bad.status).toBe(400);
    expect(m.pageDoc.update).not.toHaveBeenCalled();

    const ok = await post({ maintainerId: "linus" });
    expect(ok.status).toBe(200);
    expect(m.pageDoc.update.mock.calls[0][0].data).toEqual({
      lastEditedById: "ada",
      maintainerId: "linus",
    });
  });

  it("Core may clear the maintainer", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await post({ maintainerId: null });
    expect(m.pageDoc.update.mock.calls[0][0].data.maintainerId).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("action writes", () => {
  beforeEach(() => {
    vi.mocked(isCore).mockResolvedValue(true);
  });

  it("title-only edit leaves sections and legacy columns alone", async () => {
    await post({ title: "Renamed" });
    expect(m.pageDoc.update).toHaveBeenCalledWith({
      where: { id: "doc1" },
      data: { lastEditedById: "ada", title: "Renamed" },
      select: { id: true, title: true },
    });
  });

  it("sections payload replaces sections, keeps prior videoKey, and mirrors the first section to legacy columns", async () => {
    await post({
      sections: [
        { id: "s1", title: "Intro v2", body: ["new"] },
        { title: "Extra", body: null },
      ],
    });
    const data = m.pageDoc.update.mock.calls[0][0].data;
    expect(data.sections).toHaveLength(2);
    expect(data.sections[0]).toEqual({ id: "s1", title: "Intro v2", body: ["new"], videoKey: "vid/1" });
    expect(data.sections[1]).toMatchObject({ title: "Extra", videoKey: null });
    expect(data.sections[1].id).toBeTruthy();
    expect(data.body).toEqual(["new"]);
    expect(data.videoKey).toBe("vid/1");
  });

  it("returns 400 with the validation message for bad sections", async () => {
    const res = await post({ sections: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add at least one section." });
    expect((await post({ sections: [{ title: "" }] })).status).toBe(400);
    expect(m.pageDoc.update).not.toHaveBeenCalled();
  });

  it("legacy body/videoKey edit patches only the first section", async () => {
    m.pageDoc.findUnique.mockResolvedValue({
      ...EXISTING,
      sections: [
        { id: "s1", title: "Intro", body: ["a"], videoKey: "vid/1" },
        { id: "s2", title: "More", body: ["b"], videoKey: null },
      ],
    });
    await post({ body: ["changed"], videoKey: null });
    const data = m.pageDoc.update.mock.calls[0][0].data;
    expect(data.sections).toEqual([
      { id: "s1", title: "Intro", body: ["changed"], videoKey: null },
      { id: "s2", title: "More", body: ["b"], videoKey: null },
    ]);
    expect(data.body).toEqual(["changed"]);
    expect(data.videoKey).toBeNull();
  });

  it("notifies only newly mentioned users, deduped, with the page link", async () => {
    await post({
      path: "/tasks",
      sections: [
        { id: "s1", title: "Intro", body: [{ mentions: ["old", "new1"] }] },
        { title: "B", body: [{ mentions: ["new1", "new2"] }] },
      ],
    });
    expect(notifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ["new1", "new2"],
        actorId: "ada",
        link: "link:/tasks",
        copyKey: "mention.document",
      }),
    );
  });

  it("does not notify when no mention was added", async () => {
    await post({ sections: [{ id: "s1", title: "Intro", body: [{ mentions: ["old"] }] }] });
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("notifies a newly assigned maintainer, but not when assigning yourself", async () => {
    await post({ maintainerId: "linus", path: "/tasks" });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "pagedoc.maintainer_assigned",
        createdByUserId: "ada",
        recipients: [{ userId: "linus" }],
      }),
    );
    vi.mocked(notify).mockClear();
    await post({ maintainerId: "ada" });
    expect(notify).not.toHaveBeenCalled();
  });
});
