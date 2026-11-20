// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modal = vi.fn();
vi.mock("~/admin/components/EmailTemplatesAdmin", () => ({
  EmailEditorModal: (props: unknown) => {
    modal(props);
    return null;
  },
}));
vi.mock("react-router", () => ({ Link: "a" }));

const { EmailStatusSection } = await import("~/hiring/components/lead-cycle/EmailStatusSection");
const { formatRespondBy } = await import("~/hiring/lib/decision-email-vars");

const offer = new Date("2027-01-08T12:00:00Z");
const waitlist = new Date("2027-01-15T12:00:00Z");
const dates = { startTermCode: "27W", offerRespondBy: offer, waitlistRespondBy: waitlist };
const slots = [
  { label: "Accepted", description: "", templateSlot: "decision:Accepted" },
  { label: "Waitlisted", description: "", templateSlot: "decision:Waitlisted" },
  { label: "Rejected", description: "", templateSlot: "decision:Rejected" },
  { label: "Received", description: "", templateSlot: "notification:ApplicationReceived" },
] as never;

let container: HTMLDivElement;
let root: Root;

function open(label: string, withDates = true) {
  act(() =>
    root.render(
      createElement(EmailStatusSection, {
        title: "Emails",
        description: "",
        slots,
        hiringEmails: {},
        canEdit: true,
        dates: withDates ? dates : undefined,
      }),
    ),
  );
  act(() => (document.querySelector(`[aria-label="Edit ${label} email"]`) as HTMLButtonElement).click());
  return modal.mock.lastCall![0] as { templateKey: string; sample?: Record<string, string> };
}

beforeEach(() => {
  modal.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("EmailStatusSection editor values", () => {
  it("gives Accepted the cycle's offer date and term", () => {
    const props = open("Accepted");
    expect(props.templateKey).toBe("hiring:decision:Accepted");
    expect(props.sample).toEqual({ respondBy: formatRespondBy(offer), startTerm: "27W" });
  });

  it("gives Waitlisted the cycle's waitlist date", () => {
    expect(open("Waitlisted").sample).toEqual({ respondBy: formatRespondBy(waitlist) });
  });

  it("gives Rejected nothing to override", () => {
    expect(open("Rejected").sample).toEqual({});
  });

  it("leaves notification emails on the registry sample", () => {
    expect(open("Received").sample).toBeUndefined();
  });

  it("leaves every email on the registry sample without dates", () => {
    expect(open("Accepted", false).sample).toBeUndefined();
  });
});
