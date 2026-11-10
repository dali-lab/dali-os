import { describe, it, expect } from "vitest";
import {
  decisionEmailVars,
  decisionEmailVarsProblem,
  formatRespondBy,
  type DecisionEmailDates,
} from "~/hiring/lib/decision-email-vars";

// 11:59:59 PM Eastern on Monday, June 8, 2026 (EDT, UTC-4).
const JUNE_8_EOD = new Date("2026-06-09T03:59:59.999Z");
// 11:59:59 PM Eastern on Friday, January 15, 2027 (EST, UTC-5).
const JAN_15_EOD = new Date("2027-01-16T04:59:59.999Z");
const NOW = new Date("2026-06-01T12:00:00Z");

const ALL_SET: DecisionEmailDates = {
  startTermCode: "27W",
  offerRespondBy: JUNE_8_EOD,
  waitlistRespondBy: JAN_15_EOD,
};
const NONE_SET: DecisionEmailDates = {
  startTermCode: null,
  offerRespondBy: null,
  waitlistRespondBy: null,
};

describe("formatRespondBy", () => {
  it("formats the Eastern calendar day, not the UTC one", () => {
    // The instant is already June 9 in UTC.
    expect(formatRespondBy(JUNE_8_EOD)).toBe("Monday, June 8, 2026");
  });

  it("formats a winter (EST) deadline on its Eastern day", () => {
    expect(formatRespondBy(JAN_15_EOD)).toBe("Friday, January 15, 2027");
  });
});

describe("decisionEmailVars", () => {
  it("gives Accepted the start term and the offer deadline", () => {
    expect(decisionEmailVars("Accepted", ALL_SET)).toEqual({
      startTerm: "27W",
      respondBy: "Monday, June 8, 2026",
    });
  });

  it("gives Waitlisted the waitlist deadline and no start term", () => {
    expect(decisionEmailVars("Waitlisted", ALL_SET)).toEqual({
      respondBy: "Friday, January 15, 2027",
    });
  });

  it.each(["Rejected", "InvitedToInterview"] as const)("gives %s nothing", (type) => {
    expect(decisionEmailVars(type, ALL_SET)).toEqual({});
  });

  it("omits values the cycle doesn't have", () => {
    expect(decisionEmailVars("Accepted", NONE_SET)).toEqual({});
    expect(decisionEmailVars("Waitlisted", NONE_SET)).toEqual({});
  });

  it("keeps the start term when only the deadline is missing", () => {
    expect(decisionEmailVars("Accepted", { ...NONE_SET, startTermCode: "26F" })).toEqual({
      startTerm: "26F",
    });
  });
});

describe("decisionEmailVarsProblem", () => {
  it("passes when every token the templates use has a value", () => {
    expect(
      decisionEmailVarsProblem("Accepted", ALL_SET, ["Starting in {{startTerm}}", "Reply by {{respondBy}}"], NOW),
    ).toBeNull();
    expect(decisionEmailVarsProblem("Waitlisted", ALL_SET, ["Opt in by {{respondBy}}"], NOW)).toBeNull();
  });

  it("passes when the templates don't use the tokens, even with nothing set", () => {
    expect(decisionEmailVarsProblem("Accepted", NONE_SET, ["Hi {{firstName}}", "Welcome to {{domain}}"], NOW)).toBeNull();
    expect(decisionEmailVarsProblem("Waitlisted", NONE_SET, ["Hi {{firstName}}"], NOW)).toBeNull();
  });

  it("blocks an Accepted email that quotes {{startTerm}} when the cycle has no term", () => {
    const problem = decisionEmailVarsProblem(
      "Accepted",
      { ...ALL_SET, startTermCode: null },
      ["starting in {{startTerm}}"],
      NOW,
    );
    expect(problem).toMatch(/\{\{startTerm\}\}/);
    expect(problem).toMatch(/Setup tab/);
  });

  it("blocks an Accepted email that quotes {{respondBy}} with no offer date", () => {
    const problem = decisionEmailVarsProblem(
      "Accepted",
      { ...ALL_SET, offerRespondBy: null },
      ["Reply by {{respondBy}}"],
      NOW,
    );
    expect(problem).toBe(
      "The Accepted email uses {{respondBy}}, but this cycle has no offer response date. Set it on the Setup tab first.",
    );
  });

  it("blocks a Waitlisted email that quotes {{respondBy}} with no waitlist date", () => {
    const problem = decisionEmailVarsProblem(
      "Waitlisted",
      { ...ALL_SET, waitlistRespondBy: null },
      ["Opt in by {{respondBy}}"],
      NOW,
    );
    expect(problem).toBe(
      "The Waitlisted email uses {{respondBy}}, but this cycle has no waitlist response date. Set it on the Setup tab first.",
    );
  });

  it("checks Waitlisted against the waitlist date, not the offer date", () => {
    expect(
      decisionEmailVarsProblem(
        "Waitlisted",
        { ...NONE_SET, offerRespondBy: JUNE_8_EOD },
        ["{{respondBy}}"],
        NOW,
      ),
    ).toMatch(/no waitlist response date/);
  });

  it("blocks a deadline that has already passed", () => {
    const after = new Date("2026-06-09T04:00:00Z");
    expect(decisionEmailVarsProblem("Accepted", ALL_SET, ["{{respondBy}}"], after)).toBe(
      "The offer response date (Monday, June 8, 2026) has passed. Update it on the Setup tab first.",
    );
  });

  it("still allows a release late on the deadline day itself", () => {
    const lateOnTheDay = new Date("2026-06-09T03:00:00Z"); // 11 PM Eastern, June 8
    expect(decisionEmailVarsProblem("Accepted", ALL_SET, ["{{respondBy}}"], lateOnTheDay)).toBeNull();
  });

  it("finds the token in any of the texts (subject, body, appended block)", () => {
    expect(
      decisionEmailVarsProblem("Accepted", NONE_SET, ["Subject", "Body", "Deadline: {{respondBy}}"], NOW),
    ).toMatch(/no offer response date/);
  });

  it.each(["Rejected", "InvitedToInterview"] as const)(
    "never blocks %s (those emails get no date; the editor lint flags the token)",
    (type) => {
      expect(decisionEmailVarsProblem(type, NONE_SET, ["{{respondBy}} {{startTerm}}"], NOW)).toBeNull();
    },
  );

  it("reports the start term before the deadline when both are missing", () => {
    expect(decisionEmailVarsProblem("Accepted", NONE_SET, ["{{startTerm}} {{respondBy}}"], NOW)).toMatch(
      /\{\{startTerm\}\}/,
    );
  });

  it("ignores whitespace variants it can't fill anyway", () => {
    expect(decisionEmailVarsProblem("Accepted", NONE_SET, ["{{ respondBy }}"], NOW)).toBeNull();
  });
});
