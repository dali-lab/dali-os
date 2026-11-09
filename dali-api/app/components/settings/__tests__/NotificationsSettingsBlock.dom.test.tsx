// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import {
  NotificationsSettingsBlock,
  type NotificationsSettingsData,
} from "~/components/settings/NotificationsSettingsBlock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const saved = vi.fn();

const base: NotificationsSettingsData = {
  prefs: [],
  slackConnected: true,
  digestSchedule: { dailyHour: 9, weeklyHour: 9, weeklyWeekday: 1 },
  digestHourEt: null,
  isAdmin: false,
  isCore: false,
  audience: "member",
  action: "/settings/notifications",
};

async function mount(props: Partial<NotificationsSettingsData> = {}) {
  const Stub = createRoutesStub([
    {
      path: "/settings/notifications",
      Component: () => createElement(NotificationsSettingsBlock, { ...base, ...props }),
      action: async ({ request }) => {
        saved(Object.fromEntries(await request.formData()));
        return { ok: true, error: null };
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(ToastProvider, null, createElement(Stub, { initialEntries: ["/settings/notifications"] })),
    ),
  );
}

const box = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  saved.mockReset();
});

describe("NotificationsSettingsBlock", () => {
  it("shows the unsaved bar only after a change, and Discard restores the saved state", async () => {
    await mount();
    expect(button("Save")).toBeUndefined();
    const desktop = box("Meeting invites desktop");
    const before = desktop.checked;
    await act(async () => desktop.click());
    expect(box("Meeting invites desktop").checked).toBe(!before);
    expect(button("Save")).toBeDefined();
    await act(async () => button("Discard")!.click());
    expect(box("Meeting invites desktop").checked).toBe(before);
    expect(button("Save")).toBeUndefined();
  });

  it("locks in-app on for required events", async () => {
    await mount();
    const inApp = box("Meeting invites in-app");
    expect(inApp.checked).toBe(true);
    expect(inApp.disabled).toBe(true);
  });

  it("disables Slack DM until Slack is connected", async () => {
    await mount({ slackConnected: false });
    expect(box("Meeting invites Slack DM").disabled).toBe(true);
  });

  it("collapsed groups show a summary instead of rows", async () => {
    await mount();
    const third = container.querySelectorAll("section > button[aria-expanded]")[2] as HTMLButtonElement;
    expect(third.getAttribute("aria-expanded")).toBe("false");
    expect(third.textContent).toMatch(/notifications?/);
  });

  it("saves every visible row through the action", async () => {
    await mount();
    await act(async () => box("Meeting invites desktop").click());
    await act(async () => button("Save")!.click());
    await act(async () => {});
    expect(saved).toHaveBeenCalledTimes(1);
    const fields = saved.mock.calls[0]![0] as Record<string, string>;
    expect(fields["meeting.invite:present"]).toBe("1");
    expect(fields["meeting.invite:inApp"]).toBe("on");
  });

  it("pictures each channel above its column header, in column order", async () => {
    await mount();
    const previews = Array.from(container.querySelectorAll("[data-channel-preview]"));
    expect(previews.map((p) => p.getAttribute("data-channel-preview"))).toEqual([
      "inApp",
      "desktop",
      "slackDm",
      "email",
    ]);
    expect(previews.map((p) => p.parentElement?.textContent)).toEqual(["In-app", "Desktop", "Slack DM", "Email"]);
    expect(previews.every((p) => p.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});

describe("NotificationsSettingsBlock outside the lab", () => {
  const portal = { audience: "portal" as const, action: "/settings/notifications" };

  it("shows only in-app and email columns, with no digest time or Slack note", async () => {
    await mount({ ...portal, slackConnected: false });
    const previews = Array.from(container.querySelectorAll("[data-channel-preview]"));
    expect(previews.map((p) => p.getAttribute("data-channel-preview"))).toEqual(["inApp", "email"]);
    expect(container.textContent).not.toMatch(/Digests arrive at/);
    expect(container.textContent).not.toMatch(/Slack/);
    expect(container.querySelector('input[aria-label$="desktop"]')).toBeNull();
  });

  it("lists only the events a portal student can receive", async () => {
    await mount(portal);
    const areas = Array.from(container.querySelectorAll("section > button[aria-expanded]")).map(
      (b) => b.querySelector("[id]")?.textContent,
    );
    expect(areas).toEqual(["Education"]);
    expect(box("Meeting invites in-app")).toBeNull();
  });

  it("starts outside-only email defaults at instant", async () => {
    await mount({ ...portal });
    const section = container.querySelector("section > button[aria-expanded]") as HTMLButtonElement;
    if (section.getAttribute("aria-expanded") === "false") await act(async () => section.click());
    await act(async () => box("New assignments in-app").click());
    await act(async () => button("Save")!.click());
    await act(async () => {});
    const fields = saved.mock.calls[0]![0] as Record<string, string>;
    expect(fields["education.assignment:email"]).toBe("Instant");
    expect(fields["education.discussion:email"]).toBe("Off");
  });

  it("shows partners their comment replies", async () => {
    await mount({ audience: "partner", action: "/settings/notifications" });
    const areas = Array.from(container.querySelectorAll("section > button[aria-expanded]")).map(
      (b) => b.querySelector("[id]")?.textContent,
    );
    expect(areas).toEqual(["Documents"]);
    expect(box("Comment replies in-app")).not.toBeNull();
  });
});
