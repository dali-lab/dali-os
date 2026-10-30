import { describe, expect, it } from "vitest";
import { interviewJoinUrl, interviewLocationVars, interviewPlace } from "../interview-location";
import { buildInviteIcs } from "../interview-ics";

const MEET = "https://meet.google.com/abc-defg-hij";
const ZOOM = "https://dartmouth.zoom.us/j/123";
const pod = { name: "Pod Appa" };

describe("interviewLocationVars", () => {
  it("puts the Meet link in the location for an online interview", () => {
    expect(interviewLocationVars({ room: null, videoUrl: MEET, zoomJoinUrl: null })).toEqual({
      location: `Online: ${MEET}`,
      meetingUrl: MEET,
    });
  });

  it("falls back to a legacy Zoom link for an online interview", () => {
    expect(interviewLocationVars({ room: null, videoUrl: null, zoomJoinUrl: ZOOM })).toEqual({
      location: `Online: ${ZOOM}`,
      meetingUrl: ZOOM,
    });
  });

  it("says Online with no link when none has been minted", () => {
    expect(interviewLocationVars({ room: null, videoUrl: null, zoomJoinUrl: null })).toEqual({
      location: "Online",
    });
  });

  it("names the pod and carries no link for an in-person interview", () => {
    expect(interviewLocationVars({ room: pod, videoUrl: null, zoomJoinUrl: null })).toEqual({
      location: "Pod Appa, DALI Lab",
    });
  });

  it("drops a stale link left on an in-person interview", () => {
    const vars = interviewLocationVars({ room: pod, videoUrl: MEET, zoomJoinUrl: ZOOM });
    expect(vars).toEqual({ location: "Pod Appa, DALI Lab" });
    expect(vars.location).not.toContain("http");
  });
});

describe("interviewJoinUrl", () => {
  it("prefers the Meet link over a legacy Zoom link", () => {
    expect(interviewJoinUrl({ room: null, videoUrl: MEET, zoomJoinUrl: ZOOM })).toBe(MEET);
  });

  it("is undefined for an in-person interview even with links on the row", () => {
    expect(interviewJoinUrl({ room: pod, videoUrl: MEET, zoomJoinUrl: ZOOM })).toBeUndefined();
  });
});

describe("interviewPlace", () => {
  it("is the bare place name with no link", () => {
    expect(interviewPlace({ room: null })).toBe("Online");
    expect(interviewPlace({ room: pod })).toBe("Pod Appa, DALI Lab");
  });
});

describe("interview invite ICS", () => {
  const ics = (iv: { room: { name: string } | null; videoUrl: string | null; zoomJoinUrl: string | null }) =>
    buildInviteIcs({
      interviewId: "iv1",
      summary: "DALI Interview",
      startTime: new Date("2026-11-03T19:00:00Z"),
      endTime: new Date("2026-11-03T19:30:00Z"),
      location: interviewPlace(iv),
      meetingUrl: interviewJoinUrl(iv),
      organizer: { email: "applications@dali.dartmouth.edu", name: "DALI Lab" },
      attendees: [{ email: "ada@example.edu", name: "Ada" }],
      sequence: 0,
    }).replace(/\r\n /g, "");

  it("lists the Meet link exactly once in LOCATION for an online interview", () => {
    const out = ics({ room: null, videoUrl: MEET, zoomJoinUrl: null });
    const location = out.split("\r\n").find((l) => l.startsWith("LOCATION:"))!;
    expect(location.split(MEET)).toHaveLength(2);
    expect(out).toContain(`Join: ${MEET}`);
  });

  it("carries no link for an in-person interview with a stale one on the row", () => {
    const out = ics({ room: pod, videoUrl: MEET, zoomJoinUrl: null });
    expect(out).not.toContain(MEET);
    expect(out).toContain("LOCATION:Pod Appa\\, DALI Lab");
  });
});
