// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CURRENT_MEMBERS_MAX_AGE_MS,
  fetchCurrentMembers,
  resetCurrentMembersForTests,
  useCurrentMembers,
  type CurrentMember,
} from "~/hiring/lib/current-members";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROSTER: CurrentMember[] = [
  { id: "ada", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" },
];

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify(ROSTER), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetCurrentMembersForTests();
  fetchMock.mockReset().mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchCurrentMembers", () => {
  it("reads the current-term roster once while it is fresh", async () => {
    expect(await fetchCurrentMembers()).toEqual(ROSTER);
    await fetchCurrentMembers();
    vi.advanceTimersByTime(CURRENT_MEMBERS_MAX_AGE_MS - 1);
    await fetchCurrentMembers();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/members?scope=current", { credentials: "include" });
  });

  it("reads again once stale", async () => {
    await fetchCurrentMembers();
    vi.advanceTimersByTime(CURRENT_MEMBERS_MAX_AGE_MS);
    await fetchCurrentMembers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    await expect(fetchCurrentMembers()).rejects.toThrow("members: 403");
    expect(await fetchCurrentMembers()).toEqual(ROSTER);
  });
});

describe("useCurrentMembers", () => {
  let root: Root;
  let seen: CurrentMember[][];

  function Probe({ enabled }: { enabled?: boolean }) {
    seen.push(useCurrentMembers(enabled));
    return null;
  }

  async function render(enabled?: boolean) {
    await act(async () => root.render(createElement(Probe, { enabled })));
  }

  beforeEach(() => {
    seen = [];
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => act(() => root.unmount()));

  it("starts empty and fills in when the roster arrives", async () => {
    await render();
    expect(seen[0]).toEqual([]);
    expect(seen.at(-1)).toEqual(ROSTER);
  });

  it("shows the last roster on the first render of a later mount, without refetching", async () => {
    await render();
    await act(async () => root.unmount());
    root = createRoot(document.createElement("div"));
    seen = [];
    await render();
    expect(seen[0]).toEqual(ROSTER);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shows the last roster immediately while refreshing a stale one", async () => {
    await render();
    await act(async () => root.unmount());
    vi.advanceTimersByTime(CURRENT_MEMBERS_MAX_AGE_MS);
    root = createRoot(document.createElement("div"));
    seen = [];
    await render();
    expect(seen[0]).toEqual(ROSTER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when disabled", async () => {
    await render(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
