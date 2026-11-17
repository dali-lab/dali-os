import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { critSubmission: { findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/resource-hub.server", () => ({ canEditResourceHub: vi.fn(), ledDomainIds: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canEditResourceHub, ledDomainIds } from "~/lib/resource-hub.server";
import { notify } from "~/lib/notify.server";
import { critActorIsAnonymous, critHiddenAuthorId, critThreadLink, loadCritTarget, notifyCritComment } from "../crit-comments.server";

const db = vi.mocked(prisma, true);
const post = (o: object = {}, hub: object | null = { id: "hub1", domainId: "d1", createdById: "u9", publishedAt: new Date(0) }) =>
  ({ id: "s1", kind: "image", title: "Logo", authorId: "u1", domainId: "d1", domain: { resourceHubPage: hub }, ...o }) as any;

beforeEach(() => {
  vi.resetAllMocks();
  db.critSubmission.findUnique.mockResolvedValue(post());
  vi.mocked(getUserRoles).mockResolvedValue([] as any);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(canEditResourceHub).mockResolvedValue(false);
  vi.mocked(ledDomainIds).mockResolvedValue([]);
});

describe("loadCritTarget access", () => {
  it("lets a member of a published hub in, without moderation", async () => {
    expect(await loadCritTarget("u2", "s1")).toMatchObject({ id: "s1", pageId: "hub1", kind: "image", authorId: "u1", canModerate: false });
  });
  it("is hidden when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(await loadCritTarget("u2", "s1")).toBeNull();
  });
  it("is hidden from someone who isn't a member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect(await loadCritTarget("u2", "s1")).toBeNull();
  });
  it("is hidden when the post or the hub is gone", async () => {
    db.critSubmission.findUnique.mockResolvedValue(null);
    expect(await loadCritTarget("u2", "s1")).toBeNull();
    db.critSubmission.findUnique.mockResolvedValue(post({}, null));
    expect(await loadCritTarget("u2", "s1")).toBeNull();
  });
  it("hides a draft hub from non-editors and shows it to editors", async () => {
    db.critSubmission.findUnique.mockResolvedValue(post({}, { id: "hub1", domainId: "d1", createdById: "u9", publishedAt: null }));
    expect(await loadCritTarget("u2", "s1")).toBeNull();
    vi.mocked(canEditResourceHub).mockResolvedValue(true);
    expect(await loadCritTarget("u3", "s1")).not.toBeNull();
  });
  it("lets Core and the domain's leads moderate, and no one else", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await loadCritTarget("core", "s1"))?.canModerate).toBe(true);
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(ledDomainIds).mockResolvedValue(["d1"]);
    expect((await loadCritTarget("lead", "s1"))?.canModerate).toBe(true);
    vi.mocked(ledDomainIds).mockResolvedValue(["other"]);
    expect((await loadCritTarget("lead2", "s1"))?.canModerate).toBe(false);
  });
  it("does not let the person who shared the work moderate", async () => {
    expect((await loadCritTarget("u1", "s1"))?.canModerate).toBe(false);
  });
});

describe("critThreadLink", () => {
  it("points at the hub's crit page with the post and thread", async () => {
    db.critSubmission.findUnique.mockResolvedValue({ domain: { resourceHubPage: { id: "hub1" } } } as any);
    expect(await critThreadLink("s1", "c1")).toBe("/resource-hub/hub1/crit?post=s1&thread=c1");
  });
  it("falls back to home when the hub is gone", async () => {
    db.critSubmission.findUnique.mockResolvedValue({ domain: { resourceHubPage: null } } as any);
    expect(await critThreadLink("s1", "c1")).toBe("/");
  });
});

describe("notifyCritComment", () => {
  const args = { submissionId: "s1", commenterId: "u2", commentId: "c1", body: "Love the spacing" };
  beforeEach(() => {
    db.critSubmission.findUnique.mockImplementation((async (q: any) =>
      q.select.title ? { authorId: "u1", title: "Logo" } : { domain: { resourceHubPage: { id: "hub1" } } }) as any);
  });

  it("tells the person who shared the work, with a link to the thread", async () => {
    await notifyCritComment(args);
    expect(notify).toHaveBeenCalledWith({
      eventType: "crit.comment",
      createdByUserId: "u2",
      message: { vars: { itemTitle: "Logo", itemDetail: "Love the spacing" }, link: "/resource-hub/hub1/crit?post=s1&thread=c1" },
      recipients: [{ userId: "u1" }],
    });
  });
  it("stays quiet when the author comments on their own post", async () => {
    await notifyCritComment({ ...args, commenterId: "u1" });
    expect(notify).not.toHaveBeenCalled();
  });
  it("stays quiet when the post has no author left", async () => {
    db.critSubmission.findUnique.mockResolvedValue({ authorId: null, title: "Logo" } as any);
    await notifyCritComment(args);
    expect(notify).not.toHaveBeenCalled();
  });
  it("still reaches the author of an anonymous post, and only the author", async () => {
    await notifyCritComment(args);
    const call = vi.mocked(notify).mock.calls[0][0];
    expect(call.recipients).toEqual([{ userId: "u1" }]);
    expect(JSON.stringify(call.message)).not.toMatch(/anonymous|u1/);
  });
  it("shortens a long preview", async () => {
    await notifyCritComment({ ...args, body: "x".repeat(300) });
    expect((vi.mocked(notify).mock.calls[0][0].message as any).vars.itemDetail).toHaveLength(201);
  });
});

describe("critHiddenAuthorId", () => {
  const anon = (o: object = {}) => post({ anonymous: true, ...o });
  it("hides the poster of an anonymous post from other members", async () => {
    db.critSubmission.findUnique.mockResolvedValue(anon());
    expect(await critHiddenAuthorId("u2", "s1")).toBe("u1");
  });
  it("shows the poster to themselves", async () => {
    db.critSubmission.findUnique.mockResolvedValue(anon());
    expect(await critHiddenAuthorId("u1", "s1")).toBeNull();
  });
  it("shows the poster to Core and to the domain's leads", async () => {
    db.critSubmission.findUnique.mockResolvedValue(anon());
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await critHiddenAuthorId("core", "s1")).toBeNull();
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(ledDomainIds).mockResolvedValue(["d1"]);
    expect(await critHiddenAuthorId("lead", "s1")).toBeNull();
    vi.mocked(ledDomainIds).mockResolvedValue(["other"]);
    expect(await critHiddenAuthorId("lead2", "s1")).toBe("u1");
  });
  it("hides nobody on a named post", async () => {
    db.critSubmission.findUnique.mockResolvedValue(post());
    expect(await critHiddenAuthorId("u2", "s1")).toBeNull();
  });
});

describe("critActorIsAnonymous", () => {
  it("is true only for the author of an anonymous post", async () => {
    db.critSubmission.findUnique.mockResolvedValue({ anonymous: true, authorId: "u1" } as any);
    expect(await critActorIsAnonymous("s1", "u1")).toBe(true);
    expect(await critActorIsAnonymous("s1", "u2")).toBe(false);
    db.critSubmission.findUnique.mockResolvedValue({ anonymous: false, authorId: "u1" } as any);
    expect(await critActorIsAnonymous("s1", "u1")).toBe(false);
  });
});
