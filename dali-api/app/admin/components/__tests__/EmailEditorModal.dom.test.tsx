// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AdminEmailRow } from "~/admin/components/EmailTemplatesAdmin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.fn();
const load = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let fetcherData: Record<string, unknown>;
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ success: toastSuccess, error: toastError }) }));
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: fetcherData, submit, load, Form: "form" }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const { EmailEditorModal } = await import("~/admin/components/EmailTemplatesAdmin");
const { EMAIL_TEMPLATE_KEYS } = await import("~/email/lib/registry");

const key = EMAIL_TEMPLATE_KEYS[0]!;
const row: AdminEmailRow = {
  key,
  subject: "Hello {{firstName}}",
  body: "Welcome aboard.",
  edited: true,
  updatedAt: "2026-11-01T00:00:00.000Z",
  updatedBy: "Ada Lovelace",
  versionCount: 1,
};

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function render(response?: Record<string, unknown>) {
  fetcherData = { rows: [row], versions: [] };
  act(() => root.render(createElement(EmailEditorModal, { templateKey: key, onClose })));
  if (!response) return;
  fetcherData = { ...fetcherData, ...response };
  act(() => root.render(createElement(EmailEditorModal, { templateKey: key, onClose })));
}

function button(name: string) {
  const el = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
  if (!el) throw new Error(`no button ${name}`);
  return el as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("EmailEditorModal", () => {
  it("loads the template from the Core email route", () => {
    render();
    expect(load).toHaveBeenCalledWith(`/core/communications/email?key=${encodeURIComponent(key)}`);
  });

  it("sends a test with the send-test intent, not save", () => {
    render();
    act(() => button("Send test").click());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      { intent: "send-test", key, subject: row.subject, body: row.body, stay: "1" },
      { method: "post", action: "/core/communications/email" },
    );
  });

  it("keeps Save disabled until the copy changes", () => {
    render();
    expect(button("Save").disabled).toBe(true);
  });

  it("confirms a test send and stays open", () => {
    render({ testSent: true });
    expect(toastSuccess).toHaveBeenCalledWith("Test sent to your DALI email");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after a save", () => {
    render({ saved: true });
    expect(toastSuccess).toHaveBeenCalledWith("Saved. Every send uses it from now on");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a server error as a toast", () => {
    render({ error: "Your account has no DALI email address on file." });
    expect(toastError).toHaveBeenCalledWith("Your account has no DALI email address on file.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the close button", () => {
    render();
    act(() => button("Close").click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("labels the dialog with the template name", () => {
    render();
    const dialog = document.querySelector('[role="dialog"]')!;
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(title?.tagName).toBe("H2");
    expect(title?.textContent?.trim().length).toBeGreaterThan(0);
  });

  describe("with this cycle's values", () => {
    const waitlisted = "hiring:decision:Waitlisted" as const;
    const waitRow = { ...row, key: waitlisted, subject: "Waitlist", body: "Reply by {{respondBy}}" };
    function renderWaitlisted(sample?: Record<string, string>) {
      fetcherData = { rows: [waitRow], versions: [] };
      act(() => root.render(createElement(EmailEditorModal, { templateKey: waitlisted, onClose, sample })));
    }

    it("previews with them", () => {
      renderWaitlisted({ respondBy: "Friday, January 8, 2027" });
      expect(document.body.textContent).toContain("Reply by Friday, January 8, 2027");
      expect(document.body.textContent).toContain("Preview with this cycle's dates and sample values");
    });

    it("sends them with a test", () => {
      renderWaitlisted({ respondBy: "Friday, January 8, 2027" });
      act(() => button("Send test").click());
      expect(submit.mock.calls[0]![0]).toMatchObject({
        intent: "send-test",
        sample: JSON.stringify({ respondBy: "Friday, January 8, 2027" }),
      });
    });

    it("sends no sample without them", () => {
      renderWaitlisted();
      act(() => button("Send test").click());
      expect(submit.mock.calls[0]![0]).not.toHaveProperty("sample");
      expect(document.body.textContent).toContain("Reply by Monday, June 8, 2026");
    });
  });
});
