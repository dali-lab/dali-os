import { describe, it, expect } from "vitest";
import { presenceRoomName, isPresenceRoom, PRESENCE_ROOM_PREFIX } from "../roomName";

describe("presenceRoomName", () => {
  it("prefixes with presence:", () => {
    expect(presenceRoomName("interview:abc")).toBe("presence:interview:abc");
  });
});

describe("isPresenceRoom", () => {
  it("returns true for presence rooms", () => {
    expect(isPresenceRoom("presence:page1")).toBe(true);
    expect(isPresenceRoom(`${PRESENCE_ROOM_PREFIX}anything`)).toBe(true);
  });

  it("returns false for content rooms", () => {
    expect(isPresenceRoom("review:abc:feedback")).toBe(false);
    expect(isPresenceRoom("interview:xyz:notes")).toBe(false);
    expect(isPresenceRoom("")).toBe(false);
  });
});
