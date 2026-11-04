// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./worklet-processor.js?url", () => ({ default: "worklet.js" }));

const doc = vi.hoisted(() => ({
  writes: [] as Array<[string, unknown]>,
  refs: new Map<string, number>(),
  hasAwareness: true,
}));
vi.mock("~/components/doc/collab-doc", () => ({
  acquireCollabDoc: (name: string) => {
    doc.refs.set(name, (doc.refs.get(name) ?? 0) + 1);
    return {
      provider: {
        awareness: doc.hasAwareness
          ? {
              getLocalState: () => ({ user: { userId: "u-ada", name: "Ada" } }),
              setLocalStateField: (field: string, value: unknown) => void doc.writes.push([field, value]),
            }
          : null,
      },
    };
  },
  releaseCollabDoc: (name: string) => void doc.refs.set(name, (doc.refs.get(name) ?? 0) - 1),
}));

import { adoptDesktopSession, clearLiveSession, resetLiveSession } from "./live-session";
import { holdRecordingPresence, releaseRecordingPresence } from "./recording-presence";

const recordingWrites = () => doc.writes.filter(([field]) => field === "recording").map(([, value]) => value);

beforeEach(() => {
  doc.writes = [];
  doc.refs.clear();
  doc.hasAwareness = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recording: null }))));
});

afterEach(() => {
  releaseRecordingPresence();
  resetLiveSession();
  vi.unstubAllGlobals();
});

describe("holdRecordingPresence", () => {
  it("announces the recording with its id and the recorder's user id", () => {
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });

    expect(recordingWrites()).toEqual([{ userId: "u-ada", since: expect.any(Number), recordingId: "r1" }]);
    expect(doc.refs.get("doc-a")).toBe(1);
  });

  it("is a no-op when the same recording is already held", () => {
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });

    expect(recordingWrites()).toHaveLength(1);
    expect(doc.refs.get("doc-a")).toBe(1);
  });

  it("swaps to a new recording, clearing the old room first", () => {
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });
    holdRecordingPresence({ recordingId: "r2", documentName: "doc-b", collabToken: "tok" });

    expect(recordingWrites()).toEqual([
      expect.objectContaining({ recordingId: "r1" }),
      null,
      expect.objectContaining({ recordingId: "r2" }),
    ]);
    expect(doc.refs.get("doc-a")).toBe(0);
    expect(doc.refs.get("doc-b")).toBe(1);
  });

  it("releases the room when the provider has no awareness", () => {
    doc.hasAwareness = false;
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });

    expect(doc.refs.get("doc-a")).toBe(0);
  });

  it("stays up while no live session has been seen yet", () => {
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });
    adoptDesktopSession({ recordingId: "other", documentName: "doc-z", status: "recording", startedAt: 0 });
    clearLiveSession("other");

    expect(recordingWrites()).toHaveLength(1);
  });

  it("clears when the live session for the recording ends off the note", () => {
    adoptDesktopSession({ recordingId: "r1", documentName: "doc-a", status: "recording", startedAt: 0 });
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });

    clearLiveSession("r1");

    expect(recordingWrites().at(-1)).toBeNull();
    expect(doc.refs.get("doc-a")).toBe(0);
  });
});

describe("releaseRecordingPresence", () => {
  it("ignores a release for a recording that is not the one held", () => {
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });

    releaseRecordingPresence("r-other");

    expect(recordingWrites()).toHaveLength(1);
    expect(doc.refs.get("doc-a")).toBe(1);
  });

  it("clears the field and releases the room once", () => {
    holdRecordingPresence({ recordingId: "r1", documentName: "doc-a", collabToken: "tok" });

    releaseRecordingPresence("r1");
    releaseRecordingPresence("r1");

    expect(recordingWrites().at(-1)).toBeNull();
    expect(doc.refs.get("doc-a")).toBe(0);
  });
});
