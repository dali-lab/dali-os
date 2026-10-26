// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EMPTY_PARTICIPANTS,
  PARTICIPANTS_MAX_AGE_MS,
  fetchParticipantOptions,
  resetParticipantOptionsForTests,
  useParticipantOptions,
} from "~/calendar/lib/participant-options";
import type { ParticipantOptions } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: ParticipantOptions = {
  groups: [],
  users: [{ id: "ada", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" }] as never,
  mentorPairs: [],
};

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify(OPTIONS), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetParticipantOptionsForTests();
  fetchMock.mockReset().mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchParticipantOptions", () => {
  it("reads the endpoint once and shares the answer while it is fresh", async () => {
    expect(await fetchParticipantOptions()).toEqual(OPTIONS);
    await fetchParticipantOptions();
    vi.advanceTimersByTime(PARTICIPANTS_MAX_AGE_MS - 1);
    await fetchParticipantOptions();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/calendar/participants", { credentials: "include" });
  });

  it("reads again once the answer is older than the max age", async () => {
    await fetchParticipantOptions();
    vi.advanceTimersByTime(PARTICIPANTS_MAX_AGE_MS);
    await fetchParticipantOptions();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failure, so the next call retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    await expect(fetchParticipantOptions()).rejects.toThrow("participants: 500");

    expect(await fetchParticipantOptions()).toEqual(OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useParticipantOptions", () => {
  let root: Root;
  let seen: ParticipantOptions[];

  function Probe({ enabled, refreshKey }: { enabled: boolean; refreshKey?: unknown }) {
    seen.push(useParticipantOptions(enabled, refreshKey));
    return null;
  }

  async function render(props: { enabled: boolean; refreshKey?: unknown }) {
    await act(async () => root.render(createElement(Probe, props)));
  }

  beforeEach(() => {
    seen = [];
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => act(() => root.unmount()));

  it("starts empty and fills in once the directory arrives", async () => {
    await render({ enabled: true });

    expect(seen[0]).toBe(EMPTY_PARTICIPANTS);
    expect(seen.at(-1)).toEqual(OPTIONS);
  });

  it("never fetches when disabled, as on the portal calendar", async () => {
    await render({ enabled: false });

    expect(seen.at(-1)).toBe(EMPTY_PARTICIPANTS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-checks on a new refresh key, reading again only once stale", async () => {
    await render({ enabled: true, refreshKey: false });
    await render({ enabled: true, refreshKey: true });
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(PARTICIPANTS_MAX_AGE_MS);
    await render({ enabled: true, refreshKey: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stays empty if the read fails", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 500 }));
    await render({ enabled: true });

    expect(seen.at(-1)).toBe(EMPTY_PARTICIPANTS);
  });
});
