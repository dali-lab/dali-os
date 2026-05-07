import { describe, it, expect } from "vitest";
import {
  ALL_TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_DESCRIPTIONS,
  decisionSlot,
  notificationSlot,
  extractPlaceholders,
  lintTemplate,
  renderForSlot,
} from "~/hiring/lib/email-variables";

describe("extractPlaceholders", () => {
  it("returns the names of every {{token}} occurrence", () => {
    expect(extractPlaceholders("Hi {{firstName}}, re {{domain}}.")).toEqual([
      "firstName",
      "domain",
    ]);
  });

  it("returns duplicates in order — caller decides whether to dedupe", () => {
    expect(extractPlaceholders("{{a}}, {{a}} again")).toEqual(["a", "a"]);
  });

  it("returns an empty array when there are no placeholders", () => {
    expect(extractPlaceholders("plain text")).toEqual([]);
  });

  it("does not match tokens with internal whitespace (interpolator can't either)", () => {
    expect(extractPlaceholders("{{ firstName }}")).toEqual([]);
  });

  it("matches tokens with underscores and digits", () => {
    expect(extractPlaceholders("{{first_name1}}")).toEqual(["first_name1"]);
  });
});

describe("lintTemplate", () => {
  it("flags unknown placeholders globally when no slot is given", () => {
    const r = lintTemplate("Hi {{firstName}} {{firstname}} {{bogus}}");
    expect(r.unknown.sort()).toEqual(["bogus", "firstname"]);
    expect(r.unfilled).toEqual([]);
  });

  it("flags slot-unfilled placeholders", () => {
    // Rejected only fills firstName + domain; {{time}} would render empty.
    const r = lintTemplate("Hi {{firstName}} at {{time}}", decisionSlot("Rejected"));
    expect(r.unknown).toEqual([]);
    expect(r.unfilled).toEqual(["time"]);
  });

  it("flags both unknown and unfilled together", () => {
    const r = lintTemplate(
      "{{firstName}} {{time}} {{Firstname}}",
      decisionSlot("Rejected"),
    );
    expect(r.unknown).toEqual(["Firstname"]);
    expect(r.unfilled).toEqual(["time"]);
  });

  it("does not flag a valid placeholder for a slot that fills it", () => {
    const r = lintTemplate(
      "{{firstName}} {{time}} {{location}} {{meetingUrl}}",
      notificationSlot("InterviewConfirmedApplicant"),
    );
    expect(r.unknown).toEqual([]);
    expect(r.unfilled).toEqual([]);
  });

  it("flags {{domain}} on ApplicationReceived (intentionally not populated)", () => {
    const r = lintTemplate("Hi {{firstName}} re {{domain}}", notificationSlot("ApplicationReceived"));
    expect(r.unknown).toEqual([]);
    expect(r.unfilled).toEqual(["domain"]);
  });

  it("dedupes repeated tokens in the result", () => {
    const r = lintTemplate("{{bogus}} {{bogus}}");
    expect(r.unknown).toEqual(["bogus"]);
  });
});

describe("TEMPLATE_VARIABLES registry shape", () => {
  it("covers every decision and notification slot", () => {
    expect(Object.keys(TEMPLATE_VARIABLES).sort()).toEqual(
      [
        "decision:Accepted",
        "decision:InvitedToInterview",
        "decision:Rejected",
        "decision:Waitlisted",
        "notification:ApplicationReceived",
        "notification:InterviewCancelledApplicant",
        "notification:InterviewCancelledInterviewer",
        "notification:InterviewConfirmedApplicant",
        "notification:InterviewInviteMentor",
        "notification:InterviewLocationChanged",
      ].sort(),
    );
  });

  it("only lists names that are in ALL_TEMPLATE_VARIABLES", () => {
    const allowed = new Set<string>(ALL_TEMPLATE_VARIABLES);
    for (const [slot, vars] of Object.entries(TEMPLATE_VARIABLES)) {
      for (const v of vars) {
        expect(allowed.has(v), `${slot} lists unknown var ${v}`).toBe(true);
      }
    }
  });

  it("includes firstName for every slot (every recipient has a first name)", () => {
    for (const [slot, vars] of Object.entries(TEMPLATE_VARIABLES)) {
      expect(vars, `${slot} should include firstName`).toContain("firstName");
    }
  });

  it("describes every variable", () => {
    for (const v of ALL_TEMPLATE_VARIABLES) {
      expect(TEMPLATE_VARIABLE_DESCRIPTIONS[v]).toBeTruthy();
    }
  });
});

describe("registry/call-site drift guard", () => {
  // Pins the slot → vars matrix against what each call site actually passes
  // to renderForSlot. If a call site adds or drops a variable, this test
  // fails until TEMPLATE_VARIABLES is updated to match.
  const CALL_SITE_VARS: Record<string, readonly string[]> = {
    // api.decisions.$id.release.ts
    "decision:Rejected": ["firstName", "domain"],
    "decision:InvitedToInterview": ["firstName", "domain"],
    "decision:Accepted": ["firstName", "domain"],
    "decision:Waitlisted": ["firstName", "domain"],
    // api.my-application.ts
    "notification:ApplicationReceived": ["firstName"],
    // interview-emails.ts — intersection across cancel, invite, reassignment, location-change
    "notification:InterviewInviteMentor": ["firstName", "domain", "time", "location", "meetingUrl"],
    "notification:InterviewConfirmedApplicant": ["firstName", "domain", "time", "location", "meetingUrl"],
    "notification:InterviewCancelledApplicant": ["firstName", "domain", "time", "location"],
    "notification:InterviewCancelledInterviewer": ["firstName", "domain", "time", "location"],
    "notification:InterviewLocationChanged": ["firstName", "domain", "time", "location", "meetingUrl"],
  };

  it.each(Object.entries(CALL_SITE_VARS))(
    "matrix entry for %s matches what the call site passes",
    (slot, expected) => {
      const registered = TEMPLATE_VARIABLES[slot as keyof typeof TEMPLATE_VARIABLES];
      expect([...registered].sort()).toEqual([...expected].sort());
    },
  );
});

describe("renderForSlot", () => {
  it("delegates to renderEmail (subject + body are interpolated and sanitized)", () => {
    const out = renderForSlot(
      decisionSlot("Rejected"),
      { subject: "Hi {{firstName}}", body: "Hi {{firstName}},\n\nDomain {{domain}}." },
      { firstName: "Ada", domain: "Engineering" },
    );
    expect(out.subject).toBe("Hi Ada");
    expect(out.html).toBe("<p>Hi Ada,</p>\n<p>Domain Engineering.</p>");
  });
});
