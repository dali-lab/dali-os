import { describe, expect, it } from "vitest";
import { canOverrideAvailability, isSingleDomainPool, seatEligible } from "~/hiring/lib/interviewer-pool";

const row = (id: string, userId: string, domainId: string) => ({ id, userId, domainId });

describe("isSingleDomainPool", () => {
  it("is true when every interviewer is in the applicant's domains", () => {
    expect(isSingleDomainPool([row("a", "u1", "eb"), row("b", "u2", "eb")], ["eb"])).toBe(true);
  });

  it("is false once anyone sits outside them", () => {
    expect(isSingleDomainPool([row("a", "u1", "eng"), row("b", "u2", "des")], ["eng"])).toBe(false);
  });
});

describe("canOverrideAvailability", () => {
  it("lets a lead override a calendar conflict or a missing calendar", () => {
    expect(canOverrideAvailability("busy")).toBe(true);
    expect(canOverrideAvailability("no-calendar")).toBe(true);
  });

  it("never lets a lead double-book someone already interviewing then", () => {
    expect(canOverrideAvailability("booked")).toBe(false);
  });

  it("has nothing to override for someone free", () => {
    expect(canOverrideAvailability("free")).toBe(false);
  });
});

describe("seatEligible", () => {
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

  describe("in a multi-domain cycle", () => {
    const pool = [
      row("eng1", "u1", "eng"),
      row("eng2", "u2", "eng"),
      row("des1", "u3", "des"),
      row("des2", "u4", "des"),
    ];

    it("offers only the applicant's domain for the in-domain seat", () => {
      expect(
        ids(seatEligible(pool, { role: "InDomain", applicantDomainId: "eng", seatedUserIds: ["u1", "u3"] })),
      ).toEqual(["eng2"]);
    });

    it("offers only other domains for the cross-domain seat", () => {
      expect(
        ids(seatEligible(pool, { role: "CrossDomain", applicantDomainId: "eng", seatedUserIds: ["u1", "u3"] })),
      ).toEqual(["des2"]);
    });
  });

  describe("in a single-domain cycle", () => {
    const pool = [row("a", "u1", "eb"), row("b", "u2", "eb"), row("c", "u3", "eb"), row("d", "u4", "eb")];

    it("offers same-domain interviewers for the cross-domain seat, as the scheduler pairs them", () => {
      expect(
        ids(seatEligible(pool, { role: "CrossDomain", applicantDomainId: "eb", seatedUserIds: ["u1", "u2"] })),
      ).toEqual(["c", "d"]);
    });

    it("never offers someone already seated on the interview", () => {
      const out = seatEligible(pool, { role: "InDomain", applicantDomainId: "eb", seatedUserIds: ["u1", "u2"] });
      expect(ids(out)).toEqual(["c", "d"]);
    });
  });

  it("excludes a seated member's other domain row too", () => {
    const pool = [row("eng1", "u1", "eng"), row("des-u1", "u1", "des"), row("des2", "u2", "des")];
    expect(
      ids(seatEligible(pool, { role: "CrossDomain", applicantDomainId: "eng", seatedUserIds: ["u1"] })),
    ).toEqual(["des2"]);
  });
});
