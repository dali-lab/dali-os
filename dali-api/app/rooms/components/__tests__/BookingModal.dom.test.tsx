// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BookingDraft } from "~/rooms/components/BookingModal";
import type { ScheduleItem } from "~/rooms/lib/timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = { error: vi.fn(), success: vi.fn() };
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ formClass: "", formTrigger: "" }),
  modalCardClass: () => "",
}));

const { BookingModal } = await import("~/rooms/components/BookingModal");

const rooms = [
  { id: "r1", name: "Studio" },
  { id: "r2", name: "Lounge" },
];
const DAY = "2030-03-13";
// A door booking starts mid-minute.
const START = new Date(2030, 2, 13, 14, 0, 40).toISOString();
const END = new Date(2030, 2, 13, 15, 0, 0).toISOString();

function item(over: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    kind: "booking",
    id: "b1",
    title: "Crit",
    start: START,
    end: END,
    occurrenceStart: START,
    recurring: false,
    organizer: { id: "u1", firstName: "Ada", lastName: "Lovelace" },
    isEvent: false,
    source: "Display",
    bookedTitle: "Crit",
    fromCalendarEvent: false,
    ...over,
  };
}

const editDraft = (over: Partial<ScheduleItem> = {}, scope: "this" | "all" | null = null): BookingDraft => ({
  date: DAY,
  roomId: "r1",
  start: "14:00",
  end: "15:00",
  edit: { item: item(over), scope },
});

describe("BookingModal", () => {
  let root: Root;
  let host: HTMLDivElement;
  const onSaved = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const render = async (initial: BookingDraft | null) => {
    await act(async () => {
      root.render(createElement(BookingModal, { rooms, initial, onClose: vi.fn(), onSaved }));
    });
  };
  const input = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const titleInput = () => document.querySelector<HTMLInputElement>('input[placeholder="Optional"]')!;
  const submitButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const submit = async () => {
    await act(async () => {
      submitButton().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };
  const body = () => JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  const setTitle = async (value: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(titleInput(), value);
      titleInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("books through the create route with a new booking", async () => {
    await render({ date: DAY, roomId: "r2", start: "14:00", end: "15:00" });
    expect(document.body.textContent).toContain("Book a room");
    expect(submitButton().textContent).toBe("Book");
    await submit();
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms/r2/bookings", expect.objectContaining({ method: "POST" }));
    expect(toast.success).toHaveBeenCalledWith("Booked Lounge.");
    expect(onSaved).toHaveBeenCalledWith(DAY);
  });

  it("explains an end before the start instead of silently disabling Book", async () => {
    await render({ date: DAY, roomId: "r1", start: "15:00", end: "14:00" });
    expect(document.body.textContent).toContain("The end has to be after the start");
    expect(submitButton().disabled).toBe(true);
  });

  it("opens an edit filled in, and saves through the update route", async () => {
    await render(editDraft());
    expect(document.body.textContent).toContain("Edit booking");
    expect(titleInput().value).toBe("Crit");
    expect(submitButton().textContent).toBe("Save");
    await setTitle("Retro");
    await submit();
    expect(fetchMock).toHaveBeenCalledWith("/api/room-bookings/b1", expect.objectContaining({ method: "PATCH" }));
    expect(body()).toMatchObject({ roomId: "r1", title: "Retro" });
    expect(toast.success).toHaveBeenCalledWith("Booking updated.");
  });

  it("keeps a start it never touched down to the second, so a door booking isn't read as moved", async () => {
    await render(editDraft());
    await submit();
    expect(body()).toMatchObject({ start: START, end: END });
  });

  it("leaves an untitled booking untitled rather than saving the display fallback", async () => {
    await render(editDraft({ title: "Ada's booking", bookedTitle: null }));
    expect(titleInput().value).toBe("");
    await submit();
    expect(body().title).toBeNull();
  });

  it("limits one time of a series to its time", async () => {
    await render(editDraft({ recurring: true }, "this"));
    expect(document.body.textContent).toContain("Edit this time");
    expect(titleInput().disabled).toBe(true);
    await submit();
    const sent = body();
    expect(sent).toMatchObject({ scope: "this", occurrenceStart: START });
    expect(sent).not.toHaveProperty("roomId");
    expect(sent).not.toHaveProperty("title");
  });

  it("sends the whole series' room and title, and locks its date", async () => {
    await render(editDraft({ recurring: true }, "all"));
    expect(document.body.textContent).toContain("Edit series");
    expect(titleInput().disabled).toBe(false);
    await submit();
    expect(body()).toMatchObject({ scope: "all", occurrenceStart: START, roomId: "r1", title: "Crit" });
    expect(toast.success).toHaveBeenCalledWith("Series updated.");
  });

  it("offers no repeat control on an edit", async () => {
    await render(editDraft());
    expect(document.body.textContent).not.toContain("Repeats");
  });

  it("locks room, date and start once the booking has started, leaving the end", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await render(editDraft({ start: past, occurrenceStart: past }));
    expect(input("Starts").disabled).toBe(true);
    expect(input("Ends").disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Room"]')?.disabled).toBe(true);
  });

  it("shows the server's reason and stays open on a refusal", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Studio is already booked then ("Lab night")' }) });
    await render(editDraft());
    await submit();
    expect(toast.error).toHaveBeenCalledWith('Studio is already booked then ("Lab night")');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("recovers from a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await render(editDraft());
    await submit();
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the booking.");
    expect(submitButton().disabled).toBe(false);
  });
});
