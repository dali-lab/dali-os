// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RoomLocationField } from "./RoomLocationField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rooms = [
  { id: "r1", name: "Studio", description: null, capacity: 8, conflict: null },
  { id: "r2", name: "Lounge", description: null, capacity: null, conflict: "Design crit" },
  { id: "r3", name: "Annex", description: null, capacity: null, conflict: "Standup", conflictOn: "Oct 14" },
];

let container: HTMLDivElement;
let root: Root;
let picked: string[] = [];

function Harness() {
  const [location, setLocation] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  picked = roomIds;
  return (
    <RoomLocationField
      enabled
      id="loc"
      value={location}
      onChange={setLocation}
      roomIds={roomIds}
      onRoomsChange={setRoomIds}
      startIso="2026-10-05T14:00:00.000Z"
      endIso="2026-10-05T15:00:00.000Z"
    />
  );
}

const fetchMock = vi.fn();
beforeEach(async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rooms }) });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const input = () => container.querySelector("input") as HTMLInputElement;
const option = (name: string) =>
  Array.from(document.querySelectorAll('[role="option"]')).find((o) =>
    o.textContent?.includes(name),
  ) as HTMLButtonElement;

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RoomLocationField", () => {
  it("asks for availability in the event's window", () => {
    expect(fetchMock.mock.calls[0][0]).toContain("start=2026-10-05T14%3A00%3A00.000Z");
  });

  it("picking a room writes it as the location and holds it", () => {
    act(() => input().focus());
    act(() => option("Studio").click());
    expect(input().value).toBe("Studio");
    expect(picked).toEqual(["r1"]);
    expect(container.textContent).toContain("Books Studio for this time.");
  });

  it("shows a taken room as unavailable and won't pick it", () => {
    act(() => input().focus());
    expect(option("Lounge").textContent).toContain("Unavailable, booked for Design crit");
    act(() => option("Lounge").click());
    expect(picked).toEqual([]);
    expect(input().value).toBe("");
  });

  it("shows a series conflict's date alongside what booked it", () => {
    act(() => input().focus());
    expect(option("Annex").textContent).toContain("Unavailable on Oct 14, booked for Standup");
  });

  it("typing another location drops the room", () => {
    act(() => input().focus());
    act(() => option("Studio").click());
    type("Studio, or Zoom");
    expect(picked).toEqual([]);
    expect(input().value).toBe("Studio, or Zoom");
  });
});
