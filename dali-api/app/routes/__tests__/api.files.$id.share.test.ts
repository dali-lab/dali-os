import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/share-params.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/share-params.server")>("~/lib/share-params.server");
  return { ...actual, loadShareOptions: vi.fn() };
});
vi.mock("~/lib/file-sharing.server", () => ({ listFileShares: vi.fn() }));
vi.mock("~/lib/page-sharing.server", async () => {
  const { BadRequestError } = await import("~/lib/http-error");
  return { SharePrincipalError: class SharePrincipalError extends BadRequestError {} };
});
vi.mock("~/lib/file-share-access.server", async () => {
  const { BadRequestError, ForbiddenError, NotFoundError } = await import("~/lib/http-error");
  return {
    requireFileShareManager: vi.fn(),
    setFileGeneralAccess: vi.fn(),
    shareFileWith: vi.fn(),
    unshareFile: vi.fn(),
    FileShareForbiddenError: class FileShareForbiddenError extends ForbiddenError {},
    FileShareNotFoundError: class FileShareNotFoundError extends NotFoundError {},
    FileGeneralAccessError: class FileGeneralAccessError extends BadRequestError {},
  };
});

import { requireMemberSession } from "~/lib/auth";
import { loadShareOptions } from "~/lib/share-params.server";
import { listFileShares } from "~/lib/file-sharing.server";
import { SharePrincipalError } from "~/lib/page-sharing.server";
import {
  requireFileShareManager,
  setFileGeneralAccess,
  shareFileWith,
  unshareFile,
  FileShareForbiddenError,
  FileShareNotFoundError,
  FileGeneralAccessError,
} from "~/lib/file-share-access.server";
import { action } from "../api.files.$id.share";

const CONTEXT = { file: { id: "f1", title: "Budget.xlsx" }, linkAccess: "Restricted" };

function run(intent: string, fields: Record<string, string> = {}, method = "POST") {
  const body = new FormData();
  body.set("intent", intent);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/api/files/f1/share", {
      method,
      ...(method === "POST" ? { body } : {}),
    }),
    params: { id: "f1" },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "me" } } } as never);
  vi.mocked(requireFileShareManager).mockResolvedValue(CONTEXT as never);
  vi.mocked(listFileShares).mockResolvedValue([{ id: "s1" }] as never);
});

describe("POST /api/files/:id/share", () => {
  it("rejects other methods", async () => {
    expect((await run("state", {}, "GET")).status).toBe(405);
  });

  it("passes through the session gate's response", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);
    expect((await run("state")).status).toBe(401);
  });

  it("rejects an unknown intent", async () => {
    const res = await run("explode");
    expect(res.status).toBe(400);
    expect(shareFileWith).not.toHaveBeenCalled();
  });

  it("state returns the context and shares to a manager", async () => {
    const res = await run("state");
    expect(await res.json()).toEqual({ ok: true, context: CONTEXT, shares: [{ id: "s1" }] });
    expect(requireFileShareManager).toHaveBeenCalledWith("f1", "me", expect.any(Request));
  });

  it("share-options is manager-gated and name-scoped", async () => {
    vi.mocked(loadShareOptions).mockResolvedValue({ members: [], groups: [] });
    await run("share-options", { q: " ad " });
    expect(requireFileShareManager).toHaveBeenCalled();
    expect(loadShareOptions).toHaveBeenCalledWith("me", "ad");
  });

  it("share-add grants through the shared path with the parsed level", async () => {
    vi.mocked(shareFileWith).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    const res = await run("share-add", { principalType: "User", principalId: "u2", permission: "Edit" });
    expect(await res.json()).toEqual({ ok: true, alreadyShared: false, changed: true });
    expect(shareFileWith).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "f1", actorId: "me", principalType: "User", principalId: "u2", permission: "Edit" }),
    );
  });

  it("share-change on a group goes through the same path", async () => {
    vi.mocked(shareFileWith).mockResolvedValue({ ok: true, alreadyShared: true, changed: true });
    await run("share-change", { principalType: "Group", principalId: "g1", permission: "View" });
    expect(shareFileWith).toHaveBeenCalledWith(expect.objectContaining({ principalType: "Group", permission: "View" }));
  });

  it("falls back to View for an unrecognised permission", async () => {
    vi.mocked(shareFileWith).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    await run("share-add", { principalId: "u2", permission: "Owner" });
    expect(shareFileWith).toHaveBeenCalledWith(expect.objectContaining({ permission: "View", principalType: "User" }));
  });

  it("share-add without a principal is a 400 and writes nothing", async () => {
    const res = await run("share-add", { principalType: "User" });
    expect(res.status).toBe(400);
    expect(shareFileWith).not.toHaveBeenCalled();
  });

  it("maps an unknown principal to a 400", async () => {
    vi.mocked(shareFileWith).mockRejectedValue(new SharePrincipalError("That member no longer exists"));
    const res = await run("share-add", { principalType: "User", principalId: "ghost" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That member no longer exists" });
  });

  it("a non-manager gets 403 on every mutating intent", async () => {
    vi.mocked(shareFileWith).mockRejectedValue(new FileShareForbiddenError());
    vi.mocked(unshareFile).mockRejectedValue(new FileShareForbiddenError());
    vi.mocked(requireFileShareManager).mockRejectedValue(new FileShareForbiddenError());
    expect((await run("share-add", { principalId: "u2" })).status).toBe(403);
    expect((await run("share-remove", { shareId: "s1" })).status).toBe(403);
    expect((await run("general-access", { linkAccess: "LabMembers" })).status).toBe(403);
    expect((await run("state")).status).toBe(403);
    expect(setFileGeneralAccess).not.toHaveBeenCalled();
  });

  it("a user who cannot see the file gets 404", async () => {
    vi.mocked(requireFileShareManager).mockRejectedValue(new FileShareNotFoundError());
    expect((await run("state")).status).toBe(404);
  });

  it("share-remove unshares by share id", async () => {
    const res = await run("share-remove", { shareId: "s1" });
    expect(await res.json()).toEqual({ ok: true });
    expect(unshareFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: "f1", actorId: "me", shareId: "s1" }));
  });

  it("general-access sets the lab link level", async () => {
    vi.mocked(setFileGeneralAccess).mockResolvedValue({ linkAccess: "LabMembers", linkPermission: "Edit" });
    const res = await run("general-access", { linkAccess: "LabMembers", linkPermission: "Edit" });
    expect(await res.json()).toEqual({ ok: true, linkAccess: "LabMembers", linkPermission: "Edit" });
    expect(setFileGeneralAccess).toHaveBeenCalledWith("f1", "me", { linkAccess: "LabMembers", linkPermission: "Edit" });
  });

  it("general-access rejection (public, full access) is a 400", async () => {
    vi.mocked(setFileGeneralAccess).mockRejectedValue(new FileGeneralAccessError("Links can't grant full access"));
    const res = await run("general-access", { linkAccess: "LabMembers", linkPermission: "FullAccess" });
    expect(res.status).toBe(400);
  });
});
