import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "~/partners/routes/api.partner-applications.$id.move";

const db = prisma as unknown as Record<string, any>;
const APP_ID = "app-1";

function callAction(body: unknown) {
  const request = new Request(`http://localhost/api/partner-applications/${APP_ID}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: APP_ID }, context: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", type: "member", email: "c@dali" },
  });
  (isCore as any).mockResolvedValue(true);
  db.partnerApplication.findUnique.mockResolvedValue({ id: APP_ID, stage: "New" });
  db.partnerApplication.update.mockResolvedValue({});
  db.partnerApplication.aggregate.mockResolvedValue({ _min: { position: null } });
  db.partnerActivity.create.mockResolvedValue({});
  db.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(db));
});

describe("partner application move — guards", () => {
  it("rejects non-Core callers", async () => {
    (isCore as any).mockResolvedValue(false);
    const res = (await callAction({ stage: "Interview", position: 0 })) as Response;
    expect(res.status).toBe(403);
  });

  it("404s on a missing application", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    const res = (await callAction({ stage: "Interview", position: 0 })) as Response;
    expect(res.status).toBe(404);
  });

  it("rejects an invalid stage", async () => {
    const res = (await callAction({ stage: "NotAStage", position: 0 })) as Response;
    expect(res.status).toBe(400);
  });

  it("rejects orderedIds that omit the moved application", async () => {
    const res = (await callAction({ stage: "Interview", orderedIds: ["other-1"] })) as Response;
    expect(res.status).toBe(400);
  });

  it("rejects orderedIds that don't all resolve to real applications", async () => {
    db.partnerApplication.findMany.mockResolvedValue([{ id: APP_ID }]);
    const res = (await callAction({
      stage: "Interview",
      orderedIds: [APP_ID, "ghost-1"],
    })) as Response;
    expect(res.status).toBe(400);
  });
});

describe("partner application move — orderedIds (drag and drop)", () => {
  it("moves the card to the new stage and renumbers the column densely", async () => {
    db.partnerApplication.findMany.mockResolvedValue([
      { id: "b" },
      { id: APP_ID },
      { id: "c" },
    ]);
    const res = (await callAction({
      stage: "Interview",
      orderedIds: ["b", APP_ID, "c"],
    })) as Response;
    expect(res.status).toBe(200);
    // setApplicationStage's own update (stage move, logged).
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APP_ID },
        data: expect.objectContaining({ stage: "Interview" }),
      }),
    );
    expect(db.partnerActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "StatusChanged" }),
      }),
    );
    // The renumbering pass positions every listed id by its index.
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: "b" },
      data: { position: 0 },
    });
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: APP_ID },
      data: { position: 1 },
    });
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: "c" },
      data: { position: 2 },
    });
  });

  it("does not log a stage change when reordering within the same column", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ id: APP_ID, stage: "New" });
    db.partnerApplication.findMany.mockResolvedValue([{ id: APP_ID }, { id: "b" }]);
    const res = (await callAction({
      stage: "New",
      orderedIds: [APP_ID, "b"],
    })) as Response;
    expect(res.status).toBe(200);
    expect(db.partnerActivity.create).not.toHaveBeenCalled();
  });
});

describe("partner application move — legacy { stage, position }", () => {
  it("sets the stage and the explicit position", async () => {
    const res = (await callAction({ stage: "Accepted", position: 3 })) as Response;
    expect(res.status).toBe(200);
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APP_ID },
        data: expect.objectContaining({ stage: "Accepted", position: 3 }),
      }),
    );
  });
});
