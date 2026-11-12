import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { term: { findUnique: vi.fn() }, user: { findMany: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: vi.fn(() => null),
}));
vi.mock("~/lib/outbound.server", () => ({ enqueueOutbound: vi.fn(), drainNow: vi.fn() }));
vi.mock("~/slack/lib/slack-client", () => ({ slackConfigured: vi.fn() }));
vi.mock("~/slack/lib/send-gate", () => ({ slackSendAllowed: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn(),
  absoluteLink: vi.fn((l: string) => `https://os.example.edu${l}`),
}));
vi.mock("../../lib/visibility", () => ({
  mentorshipPairWhere: vi.fn(),
  mentorNoteWhere: vi.fn(),
}));
vi.mock("../../lib/mentor-grid.server", async () => ({
  buildGrid: vi.fn(),
  isUnfilled: (await vi.importActual<typeof import("../../lib/grid-cell")>("../../lib/grid-cell")).isUnfilled,
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { handlePreflight } from "~/lib/cors";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { slackConfigured } from "~/slack/lib/slack-client";
import { notify } from "~/lib/notify.server";
import { slackSendAllowed } from "~/slack/lib/send-gate";
import { mentorshipPairWhere, mentorNoteWhere } from "../../lib/visibility";
import { buildGrid } from "../../lib/mentor-grid.server";
import { action } from "../api.mentorship.nudge";

const m = prisma as any;
const term = { id: "term1", code: "26F", startDate: new Date("2026-09-14"), endDate: new Date("2026-11-20") };

const cell = (week: number, state: "submitted" | "missing" | "future", vibe: string | null = null) => ({ week, state, vibe });
const person = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });

function grid() {
  return {
    mentors: [
      {
        mentor: person("m1", "Ada", "Lovelace"),
        rows: [
          { mentee: person("e1", "Grace", "Hopper"), cells: [cell(1, "missing"), cell(2, "missing"), cell(3, "future")] },
          { mentee: person("e2", "Alan", "Turing"), cells: [cell(1, "submitted", "good"), cell(2, "submitted", null)] },
          { mentee: person("e3", "Done", "Person"), cells: [cell(1, "submitted", "good")] },
        ],
      },
      {
        mentor: person("m2", "Katherine", "Johnson"),
        rows: [{ mentee: person("e4", "Mary", "Jackson"), cells: [cell(1, "missing")] }],
      },
      {
        mentor: person("m3", "Complete", "Mentor"),
        rows: [{ mentee: person("e5", "X", "Y"), cells: [cell(1, "submitted", "good")] }],
      },
    ],
  };
}

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/mentorship/nudge", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    }),
  } as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(handlePreflight).mockReturnValue(null);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core1" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  m.term.findUnique.mockResolvedValue(term);
  vi.mocked(mentorshipPairWhere).mockResolvedValue({ pair: true } as any);
  vi.mocked(mentorNoteWhere).mockResolvedValue({ note: true } as any);
  vi.mocked(buildGrid).mockResolvedValue(grid() as any);
  m.user.findMany.mockResolvedValue([
    { id: "m1", firstName: "Ada", lastName: "Lovelace", slackUserId: "U1" },
    { id: "m2", firstName: "Katherine", lastName: "Johnson", slackUserId: null },
  ]);
  vi.mocked(slackConfigured).mockReturnValue(true);
  vi.mocked(slackSendAllowed).mockReturnValue(true);
  vi.mocked(enqueueOutbound).mockResolvedValue({ id: "ob1", deduped: false } as any);
});

describe("access and validation", () => {
  it("returns the preflight response untouched", async () => {
    const pre = new Response(null, { status: 204 });
    vi.mocked(handlePreflight).mockReturnValue(pre);
    expect(await post({})).toBe(pre);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("returns the auth failure for an unauthenticated caller", async () => {
    const denied = new Response("no", { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await post({ termId: "term1" })).toBe(denied);
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods with 405 before the role check", async () => {
    const res = await post(null, "PUT");
    expect(res.status).toBe(405);
    expect(isCore).not.toHaveBeenCalled();
  });

  it("is Core-only: a non-core member gets 403 and nothing is sent", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await post({ termId: "term1" });
    expect(res.status).toBe(403);
    expect(isCore).toHaveBeenCalledWith("core1");
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  it.each([[{}], [{ termId: "" }], [{ termId: 5 }], [null]])("rejects body %j without a termId string", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
  });

  it("404s on an unknown term", async () => {
    m.term.findUnique.mockResolvedValue(null);
    const res = await post({ termId: "nope" });
    expect(res.status).toBe(404);
    expect(buildGrid).not.toHaveBeenCalled();
  });
});

describe("targeting", () => {
  it("builds the grid for the filters under the caller's own visibility scope", async () => {
    await post({ termId: "term1", projectId: "p1", domainId: "d1" });
    expect(mentorshipPairWhere).toHaveBeenCalledWith("core1");
    expect(mentorNoteWhere).toHaveBeenCalledWith("core1");
    expect(buildGrid).toHaveBeenCalledWith({
      term,
      filters: { projectId: "p1", domainId: "d1" },
      viewerId: "core1",
      pairScope: { pair: true },
      noteScope: { note: true },
    });
  });

  it("returns an empty result without any lookups when no mentor is behind", async () => {
    vi.mocked(buildGrid).mockResolvedValue({ mentors: [grid().mentors[2]] } as any);
    const res = await post({ termId: "term1" });
    expect(await res.json()).toEqual({ messaged: [], skippedNoSlack: [], sentInEnv: true });
    expect(m.user.findMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("bulk nudge targets only mentors with unfilled due weeks, and looks only those users up", async () => {
    await post({ termId: "term1" });
    expect(m.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["m1", "m2"] } });
  });

  it("a mentorId nudges just that mentor", async () => {
    const res = await post({ termId: "term1", mentorId: "m1" });
    expect(m.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["m1"] } });
    expect((await res.json()).messaged).toEqual(["Ada Lovelace"]);
  });

  it("a mentorId who is not behind (or not visible) yields nothing", async () => {
    const res = await post({ termId: "term1", mentorId: "m3" });
    expect(await res.json()).toEqual({ messaged: [], skippedNoSlack: [], sentInEnv: true });
    const res2 = await post({ termId: "term1", mentorId: "unknown" });
    expect((await res2.json()).messaged).toEqual([]);
  });
});

describe("Slack delivery", () => {
  it("DMs mentors with a Slack id, force-sent, with their outstanding weeks and a link", async () => {
    const res = await post({ termId: "term1" });
    expect(await res.json()).toEqual({ messaged: ["Ada Lovelace"], skippedNoSlack: ["Katherine Johnson"], sentInEnv: true });
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(enqueueOutbound).mock.calls[0][0] as any;
    expect(arg).toMatchObject({
      channel: "slack_dm",
      target: "U1",
      recipientUserId: "m1",
      eventType: "mentorship.note_reminder",
      createdByUserId: "core1",
    });
    expect(arg.dedupKey).toMatch(/^mentor-nudge:m1:term1:\d{4}-\d{2}-\d{2}$/);
    expect(arg.slackText).toBe(
      [
        "Hi Ada,",
        "",
        "This is a reminder to fill in your weekly mentorship notes.",
        "",
        "Still needed for 26F:",
        "• Grace Hopper — weeks 1, 2\n• Alan Turing — week 2",
        "",
        "<https://os.example.edu/mentorship/browse|Open in DALI OS>",
      ].join("\n"),
    );
    expect(drainNow).toHaveBeenCalledWith(["ob1"]);
  });

  it("uses a trimmed custom intro capped at 1000 chars, defaulting when blank", async () => {
    await post({ termId: "term1", intro: `  ${"z".repeat(1500)}  ` });
    expect((vi.mocked(enqueueOutbound).mock.calls[0][0] as any).slackText).toContain(`\n${"z".repeat(1000)}\n`);
    expect((vi.mocked(enqueueOutbound).mock.calls[0][0] as any).slackText).not.toContain("z".repeat(1001));
    vi.mocked(enqueueOutbound).mockClear();
    await post({ termId: "term1", intro: "   " });
    expect((vi.mocked(enqueueOutbound).mock.calls[0][0] as any).slackText).toContain("This is a reminder to fill in your weekly mentorship notes.");
  });

  it("does not drain a deduped message but still reports the mentor as messaged", async () => {
    vi.mocked(enqueueOutbound).mockResolvedValue({ id: "ob1", deduped: true } as any);
    const res = await post({ termId: "term1" });
    expect((await res.json()).messaged).toEqual(["Ada Lovelace"]);
    expect(drainNow).not.toHaveBeenCalled();
  });

  it.each([
    ["Slack not configured", () => vi.mocked(slackConfigured).mockReturnValue(false)],
    ["Slack DMs not allowed in this environment", () => vi.mocked(slackSendAllowed).mockReturnValue(false)],
  ])("sends nothing when %s but reports who would be messaged", async (_n, setup) => {
    setup();
    const res = await post({ termId: "term1" });
    expect(await res.json()).toEqual({ messaged: ["Ada Lovelace", "Katherine Johnson"], skippedNoSlack: [], sentInEnv: false });
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(drainNow).not.toHaveBeenCalled();
  });
});

describe("in-app notification", () => {
  it("goes through notify() with a per-mentor outstanding list, including mentors without Slack", async () => {
    await post({ termId: "term1" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      eventType: "mentorship.note_reminder",
      createdByUserId: "core1",
      message: { link: "/mentorship/browse" },
      recipients: [
        {
          userId: "m1",
          vars: { itemDetail: "Still needed for 26F:\n• Grace Hopper — weeks 1, 2\n• Alan Turing — week 2" },
        },
        { userId: "m2", vars: { itemDetail: "Still needed for 26F:\n• Mary Jackson — week 1" } },
      ],
    });
  });

  it("still records the in-app trail when Slack is gated off", async () => {
    vi.mocked(slackSendAllowed).mockReturnValue(false);
    await post({ termId: "term1", mentorId: "m2" });
    expect((vi.mocked(notify).mock.calls[0][0] as any).recipients.map((r: any) => r.userId)).toEqual(["m2"]);
  });

  it("does not notify a targeted mentor whose user row is missing", async () => {
    m.user.findMany.mockResolvedValue([{ id: "m2", firstName: "Katherine", lastName: "Johnson", slackUserId: "U2" }]);
    const res = await post({ termId: "term1" });
    expect((await res.json()).messaged).toEqual(["Katherine Johnson"]);
    expect((vi.mocked(notify).mock.calls[0][0] as any).recipients.map((r: any) => r.userId)).toEqual(["m2"]);
  });
});
