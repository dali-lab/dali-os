// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EmailEngagement } from "~/hiring/lib/email-engagement.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children?: unknown }) =>
    createElement("a", { href: to }, children as never),
  useRouteLoaderData: () => undefined,
}));

const { ApplicantEmailPanel } = await import("~/hiring/components/ApplicantEmailPanel");

const thread = {
  indexId: "idx-1",
  subject: "Question about the design challenge",
  firstAt: "2026-10-01T12:00:00.000Z",
  lastAt: "2026-10-02T12:00:00.000Z",
  messages: 3,
  inbound: 2,
  outbound: 1,
  fromThem: 2,
  startedByThem: true,
};

const engagement = (threads: EmailEngagement["threads"]): EmailEngagement => ({
  totals: {
    fromThem: threads.reduce((n, t) => n + t.fromThem, 0),
    threadsStarted: threads.filter((t) => t.startedByThem).length,
    lastFromThemAt: threads.at(-1)?.lastAt ?? null,
  },
  threads,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(props: Partial<Parameters<typeof ApplicantEmailPanel>[0]>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(ApplicantEmailPanel, {
        engagement: engagement([thread]),
        blinded: false,
        applicationId: "app-1",
        defaultOpen: true,
        ...props,
      }),
    );
  });
  return host;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("ApplicantEmailPanel", () => {
  it("links Write email to the mail client, addressed to the applicant from applications@", async () => {
    const el = await mount({ composeTo: "pat.q.applicant@dartmouth.edu" });
    const link = [...el.querySelectorAll("a")].find((a) => a.textContent?.includes("Write email"));
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe(
      "/email?compose=pat.q.applicant%40dartmouth.edu&from=applications%40dali.dartmouth.edu",
    );
  });

  it("offers no Write email action without an address (blinded pages pass none)", async () => {
    const el = await mount({ blinded: true, composeTo: null });
    expect(el.textContent).not.toContain("Write email");
  });

  it("still shows the panel with no mail history so a first email can be written", async () => {
    const el = await mount({ engagement: engagement([]), composeTo: "pat.q.applicant@dartmouth.edu" });
    expect(el.textContent).toContain("Email with applications@");
    expect(el.textContent).toContain("No email yet");
    expect(el.textContent).toContain("Write email");
  });

  it("renders nothing with no history and no address, as before", async () => {
    const el = await mount({ engagement: engagement([]) });
    expect(el.textContent).toBe("");
  });
});
