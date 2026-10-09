import { describe, expect, it } from "vitest";
import { findRemoteRecording, type RecordingAwarenessState } from "./awareness";

function states(entries: [number, RecordingAwarenessState][]): Map<number, RecordingAwarenessState> {
  return new Map(entries);
}

describe("findRemoteRecording", () => {
  it("returns null when nobody is recording", () => {
    const map = states([
      [1, { user: { name: "Alex" } }],
      [2, { user: { name: "Sam" } }],
    ]);
    expect(findRemoteRecording(map, 1)).toBeNull();
  });

  it("finds a remote client's recording state", () => {
    const map = states([
      [1, { user: { name: "Alex" } }],
      [2, { user: { name: "Sam" }, recording: { userId: "u2", since: 1000 } }],
    ]);
    expect(findRemoteRecording(map, 1)).toEqual({ name: "Sam", since: 1000 });
  });

  it("excludes the local client even when it is recording", () => {
    const map = states([[1, { user: { name: "Alex" }, recording: { userId: "u1", since: 1000 } }]]);
    expect(findRemoteRecording(map, 1)).toBeNull();
  });

  it("picks the earliest-started recorder when more than one is recording", () => {
    const map = states([
      [1, { user: { name: "Alex" } }],
      [2, { user: { name: "Sam" }, recording: { userId: "u2", since: 2000 } }],
      [3, { user: { name: "Jo" }, recording: { userId: "u3", since: 500 } }],
    ]);
    expect(findRemoteRecording(map, 1)).toEqual({ name: "Jo", since: 500 });
  });

  it("falls back to 'Someone' when the recorder's name is missing", () => {
    const map = states([[2, { recording: { userId: "u2", since: 1000 } }]]);
    expect(findRemoteRecording(map, 1)).toEqual({ name: "Someone", since: 1000 });
  });

  it("ignores a cleared (null) recording field", () => {
    const map = states([[2, { user: { name: "Sam" }, recording: null }]]);
    expect(findRemoteRecording(map, 1)).toBeNull();
  });
});
