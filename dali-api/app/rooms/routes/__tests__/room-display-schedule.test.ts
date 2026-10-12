import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/room-display.server", () => ({
  requireRoomDisplay: vi.fn(),
  displayUnauthorized: vi.fn(() => Response.json({ error: "Display not paired" }, { status: 401 })),
}));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => u) }));
vi.mock("~/lib/rooms.server", () => ({
  getRoomSchedule: vi.fn(),
  currentEvent: vi.fn(),
  parseWindow: vi.fn(),
  serializeScheduleItem: vi.fn((i: unknown) => i),
}));
vi.mock("~/lib/display-scan.server", () => ({ getActiveDisplayScan: vi.fn() }));
vi.mock("~/hiring/lib/hiring-events.server", () => ({ getBroadcastEvent: vi.fn() }));

import { requireRoomDisplay } from "~/lib/room-display.server";
import { currentEvent, getRoomSchedule, parseWindow } from "~/lib/rooms.server";
import { getActiveDisplayScan } from "~/lib/display-scan.server";
import { getBroadcastEvent } from "~/hiring/lib/hiring-events.server";
import { loader } from "~/rooms/routes/api.room-display.schedule";

const display = { id: "d1", label: "Door", room: { id: "r1", name: "Lab", description: null, capacity: 8 } };
const get = () =>
  ({
    request: new Request("https://os.dali.test/api/room-display/schedule?start=a&end=b"),
    params: {},
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRoomDisplay).mockResolvedValue(display);
  vi.mocked(parseWindow).mockReturnValue({ start: new Date(), end: new Date() } as never);
  vi.mocked(getRoomSchedule).mockResolvedValue([]);
  vi.mocked(currentEvent).mockReturnValue(null);
  vi.mocked(getActiveDisplayScan).mockResolvedValue(null);
  vi.mocked(getBroadcastEvent).mockResolvedValue(null);
});

describe("room-display schedule — application event broadcast", () => {
  it("sends null when no hiring event is broadcasting", async () => {
    const body = await (await loader(get())).json();
    expect(body.applicationEvent).toBeNull();
  });

  it("sends the broadcast event with a check-in URL on the display's origin", async () => {
    vi.mocked(getBroadcastEvent).mockResolvedValue({
      id: "e1",
      title: "Application help hour",
      kind: "HelpHour",
      startsAt: new Date("2026-10-14T20:00:00Z"),
      endsAt: new Date("2026-10-14T22:00:00Z"),
      location: "Sudikoff",
    });
    const body = await (await loader(get())).json();
    expect(body.applicationEvent).toEqual({
      id: "e1",
      title: "Application help hour",
      kind: "HelpHour",
      start: "2026-10-14T20:00:00.000Z",
      end: "2026-10-14T22:00:00.000Z",
      location: "Sudikoff",
      checkInUrl: "https://os.dali.test/hiring/events/check-in/e1",
    });
  });
});
