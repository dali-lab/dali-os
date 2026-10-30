// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { RECORDING_FAVICON, RecordingPill } from "./RecordingPill";
import { adoptDesktopSession, getLiveSession, refreshLiveSession, resetLiveSession } from "./live-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./worklet-processor.js?url", () => ({ default: "worklet.js" }));

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let container: HTMLDivElement;
let root: Root;
let posts: unknown[];
let serverRow: Record<string, unknown> | null;

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  documentName: "doc:z:body",
  status: "Recording",
  title: "Weekly sync",
  href: "/documents/z",
  sessionSeconds: 65,
  ...over,
});

async function show(status: "Pending" | "Recording" | "Stopped", over: Record<string, unknown> = {}) {
  serverRow = row({ status, ...over });
  await act(async () => {
    adoptDesktopSession({ recordingId: "r1", documentName: "doc:z:body", status: "recording", startedAt: Date.now() - 65_000 });
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(opts: { at?: string; flag?: boolean } = {}) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(FeatureFlagsProvider, {
          flags: { "ai-meeting-notes": opts.flag ?? true },
          children: createElement(RecordingPill),
        }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: [opts.at ?? "/somewhere"] }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const stopButton = () => container.querySelector<HTMLButtonElement>("button[aria-label='Stop recording']");
const links = () => Array.from(container.querySelectorAll("a"));

beforeEach(() => {
  posts = [];
  document.head.innerHTML = '<link rel="icon" href="/icon-blue.svg">';
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonRes({ ok: true });
      }
      return jsonRes({ recording: serverRow });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  resetLiveSession();
  vi.unstubAllGlobals();
});

describe("RecordingPill", () => {
  it("renders nothing without a session", async () => {
    serverRow = null;
    await mount();
    expect(container.textContent).toBe("");
  });

  it("flags a recording with no sound, and clears it once sound arrives", async () => {
    serverRow = row({ noSound: true });
    await mount();
    expect(container.textContent).toContain("No sound");
    expect(stopButton()).not.toBeNull();

    serverRow = row({ noSound: false });
    await act(async () => {
      await refreshLiveSession();
    });
    expect(container.textContent).not.toContain("No sound");
  });

  it("picks up a recording the server already has on first load", async () => {
    serverRow = row();
    await mount();
    expect(container.textContent).toContain("Weekly sync");
  });

  it("does not ask the server anything when the flag is off", async () => {
    await mount({ flag: false });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("renders nothing when the flag is off, even with a session", async () => {
    await show("Recording");
    await mount({ flag: false });
    expect(container.textContent).toBe("");
  });

  it("shows the timer, the note title as a link, and Stop while recording", async () => {
    await show("Recording");
    await mount();
    expect(container.textContent).toMatch(/01:0[5-9]/);
    expect(links().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Weekly sync", "/documents/z"]]);
    expect(stopButton()?.textContent).toContain("Stop");
  });

  it("says Starting in place of the timer, with Stop available", async () => {
    await show("Pending", { sessionSeconds: null });
    await mount();
    expect(container.textContent).toContain("Starting");
    expect(container.textContent).not.toMatch(/\d\d:\d\d/);
    expect(stopButton()).not.toBeNull();
  });

  it("shows Stopping with no Stop button while the stop is in flight", async () => {
    await show("Recording");
    await mount();
    await act(async () => {
      stopButton()!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getLiveSession()?.status).toBe("stopping");
    expect(container.textContent).toContain("Stopping");
    expect(stopButton()).toBeNull();
  });

  it("Stop asks the server to stop the recording", async () => {
    await show("Recording");
    await mount();
    await act(async () => {
      stopButton()!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(posts).toEqual([{ action: "stop" }]);
  });

  it("offers Finish in note once stopped", async () => {
    await show("Stopped", { sessionSeconds: null });
    await mount();
    const finish = links().find((a) => a.textContent?.includes("Finish in note"));
    expect(finish?.getAttribute("href")).toBe("/documents/z");
    expect(stopButton()).toBeNull();
  });

  it("hides on the recorded note itself, where the rail has the controls", async () => {
    await show("Recording");
    await mount({ at: "/documents/z" });
    expect(container.textContent).toBe("");
  });

  it("shows without a link for a recording that has no note page", async () => {
    await show("Recording", { href: null, title: "Recording" });
    await mount({ at: "/documents/z" });
    expect(links()).toEqual([]);
    expect(container.textContent).toContain("Recording");
  });

  it("swaps the favicon to the recording one while capturing and restores it after", async () => {
    await show("Recording");
    await mount();
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(RECORDING_FAVICON);
    await act(async () => {
      root.unmount();
    });
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/icon-blue.svg");
  });

  it("keeps the normal favicon once the session has stopped", async () => {
    await show("Stopped", { sessionSeconds: null });
    await mount();
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/icon-blue.svg");
  });
});
