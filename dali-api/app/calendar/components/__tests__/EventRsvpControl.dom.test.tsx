// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fetcherState = "idle";
let fetcherForm: FormData | undefined;
const submit = vi.fn();
vi.mock("react-router", () => ({
  Link: "a",
  useFetcher: () => ({ state: fetcherState, formData: fetcherForm, data: undefined, submit, Form: "form" }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

const { EventRsvpControl } = await import("~/calendar/components/WeekGrid");

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(EventRsvpControl, {
        rsvp: { via: "google", status: "Pending", eventId: "e1", linkId: "l1", calendarId: "c1", recurringEventId: null },
      }),
    ),
  );
}

const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  fetcherState = "idle";
  fetcherForm = undefined;
  submit.mockClear();
});

describe("EventRsvpControl", () => {
  it("lets the answer be changed while the page re-reads after a write", async () => {
    fetcherState = "loading";
    fetcherForm = new FormData();
    fetcherForm.set("response", "accepted");
    await mount();

    expect(button("Going").disabled).toBe(false);
    expect(button("Can't go").disabled).toBe(false);
    await act(async () => button("Can't go").click());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ intent: "event-rsvp", response: "declined" }), { method: "post" });
  });

  it("shows the answer being sent as pressed", async () => {
    fetcherState = "loading";
    fetcherForm = new FormData();
    fetcherForm.set("response", "tentative");
    await mount();

    expect(button("Maybe").className).toContain("border-os-accent");
    expect(button("Going").className).not.toContain("border-os-accent");
  });

  it("holds the buttons only while the request itself is going out", async () => {
    fetcherState = "submitting";
    await mount();

    expect(button("Going").disabled).toBe(true);
  });
});
