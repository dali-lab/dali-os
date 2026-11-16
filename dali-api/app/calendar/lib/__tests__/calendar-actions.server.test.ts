import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { CalendarActionSchema } from "~/calendar/lib/calendar-schemas";
import { CALENDAR_ACTION_HANDLERS, submitCalendarAction } from "~/calendar/lib/calendar-actions.server";

function post(intent: string) {
  const body = new FormData();
  body.set("intent", intent);
  return new Request("http://localhost/calendar", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } } as never);
});

describe("calendar action handler map", () => {
  it("has a handler for every validated intent", () => {
    const schemaIntents = CalendarActionSchema.options.map((o) => o.shape.intent.value);
    expect(schemaIntents.length).toBeGreaterThan(0);
    for (const intent of schemaIntents) expect(CALENDAR_ACTION_HANDLERS[intent], intent).toBeTypeOf("function");
  });

  it("has a handler for each class, event and calendar intent", () => {
    for (const intent of [
      "class-add",
      "class-update",
      "class-remove",
      "class-refresh",
      "event-create",
      "event-update",
      "event-delete",
      "event-move",
      "event-rsvp",
      "cal-create",
      "cal-rename",
      "cal-delete",
    ]) {
      expect(CALENDAR_ACTION_HANDLERS[intent], intent).toBeTypeOf("function");
    }
  });

  it("maps nothing beyond the validated, class, event and calendar intents", () => {
    const schemaIntents = new Set<string>(CalendarActionSchema.options.map((o) => o.shape.intent.value));
    const extra = Object.keys(CALENDAR_ACTION_HANDLERS).filter(
      (k) => !schemaIntents.has(k) && !/^(class|event|cal)-/.test(k),
    );
    expect(extra).toEqual([]);
    expect(Object.keys(CALENDAR_ACTION_HANDLERS)).toHaveLength(schemaIntents.size + 12);
  });
});

describe("submitCalendarAction dispatch", () => {
  it.each(["bogus", "", "class-bogus", "event-bogus", "cal-bogus", "constructor"])(
    "answers an unknown intent %j with a 400",
    async (intent) => {
      const res = await submitCalendarAction(post(intent));
      expect(res?.status).toBe(400);
      expect(await res!.json()).toMatchObject({ error: "Invalid input" });
    },
  );

  it("returns the auth response untouched when the caller is not signed in", async () => {
    const denied = new Response("nope", { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: denied } as never);
    expect(await submitCalendarAction(post("set-event-buffer"))).toBe(denied);
  });
});
