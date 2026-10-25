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
});
