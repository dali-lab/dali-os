import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listVisibleGroupsForUser: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({
  addPageShare: vi.fn(),
  listPageShares: vi.fn(),
  removePageShare: vi.fn(),
  SharePrincipalError: class SharePrincipalError extends Error {},
}));
vi.mock("~/lib/page-share-access.server", () => ({
  requirePageShareManager: vi.fn(),
  setGeneralAccess: vi.fn(),
  setFolderScope: vi.fn(),
  notifyDocumentShared: vi.fn(),
  PageShareForbiddenError: class PageShareForbiddenError extends Error {},
  PageShareNotFoundError: class PageShareNotFoundError extends Error {},
  GeneralAccessError: class GeneralAccessError extends Error {},
}));
vi.mock("~/lib/page-audience.server", () => ({ describePageAudience: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { listPageShares } from "~/lib/page-sharing.server";
import { requirePageShareManager, PageShareForbiddenError } from "~/lib/page-share-access.server";
import { describePageAudience } from "~/lib/page-audience.server";
import { action } from "../api.pages.$id.share";

const USER_ID = "user-1";
const CONTEXT = { page: { id: "page-1", title: "Plan" }, linkAccess: "Restricted" };
const SHARES = [{ id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Ada" }];

function run(intent: string) {
  const body = new FormData();
  body.set("intent", intent);
  return action({
    request: new Request("http://localhost/api/pages/page-1/share", { method: "POST", body }),
    params: { id: "page-1" },
    context: {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as never);
  vi.mocked(requirePageShareManager).mockResolvedValue(CONTEXT as never);
  vi.mocked(listPageShares).mockResolvedValue(SHARES as never);
  vi.mocked(describePageAudience).mockResolvedValue({ audience: null, inherited: null });
});

describe("POST /api/pages/:id/share state", () => {
  it("carries the inherited folder scope and the audience summary beside the shares", async () => {
    const inherited = {
      folderId: "folder-1",
      title: "Hiring",
      scopeKind: "Group",
      groupName: "Core",
      permission: "Edit",
    };
    const audience = {
      kind: "group",
      label: "Core",
      permission: "Edit",
      inheritedFrom: { id: "folder-1", title: "Hiring" },
    };
    vi.mocked(describePageAudience).mockResolvedValue({ audience, inherited } as never);

    const res = await run("state");
    expect(await res.json()).toEqual({ ok: true, context: CONTEXT, shares: SHARES, audience, inherited });
    expect(describePageAudience).toHaveBeenCalledWith(USER_ID, "page-1");
  });

  it("sends inherited: null when nothing governs the page", async () => {
    const body = await (await run("state")).json();
    expect(body.inherited).toBeNull();
    expect(body.audience).toBeNull();
  });

  it("stays behind the manager gate and computes no audience for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    const res = await run("state");
    expect(res.status).toBe(403);
    expect(describePageAudience).not.toHaveBeenCalled();
  });
});
