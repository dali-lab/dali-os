import { describe, it, expect } from "vitest";
import {
  fillersForSharing,
  isPrefillFieldKey,
  prefillFieldFits,
  prefillFieldsFor,
  prefillReach,
} from "~/forms/lib/prefill-fields";
import type { Question } from "~/types";

const q = (type: Question["type"], data: Partial<Question["data"]> = {}) => ({
  type,
  data: { label: "Q", ...data },
});

describe("isPrefillFieldKey", () => {
  it("accepts registry keys and rejects everything else", () => {
    expect(isPrefillFieldKey("me.name")).toBe(true);
    expect(isPrefillFieldKey("partnerOrg.address")).toBe(true);
    expect(isPrefillFieldKey("me.password")).toBe(false);
    expect(isPrefillFieldKey("toString")).toBe(false);
    expect(isPrefillFieldKey(undefined)).toBe(false);
    expect(isPrefillFieldKey(3)).toBe(false);
  });
});

describe("which fields a question can take", () => {
  it("offers text fields to a short answer", () => {
    const keys = prefillFieldsFor(q("text"));
    expect(keys).toContain("me.name");
    expect(keys).toContain("partnerOrg.name");
    expect(keys).not.toContain("partnerOrg.project");
  });

  it("offers only email to an email question", () => {
    expect(prefillFieldsFor(q("email"))).toEqual(["me.email"]);
  });

  it("offers the address to a long answer", () => {
    expect(prefillFieldsFor(q("textarea"))).toEqual(["partnerOrg.address"]);
  });

  it("offers nothing to choice questions", () => {
    expect(prefillFieldsFor(q("radio"))).toEqual([]);
    expect(prefillFieldsFor(q("checkbox"))).toEqual([]);
    expect(prefillFieldsFor(q("date"))).toEqual([]);
  });

  it("offers the project only to a reference question over the partner's projects", () => {
    expect(prefillFieldsFor(q("reference", { referenceSource: "projects:my-organization" }))).toEqual([
      "partnerOrg.project",
    ]);
    expect(prefillFieldsFor(q("reference", { referenceSource: "projects:active" }))).toEqual([]);
    expect(prefillFieldFits("partnerOrg.project", q("reference"))).toBe(false);
  });
});

describe("fillersForSharing", () => {
  it("maps each general access level to who can fill", () => {
    expect(fillersForSharing("Public", [])).toEqual(["member", "partner", "other", "anonymous"]);
    expect(fillersForSharing("SignedIn", [])).toEqual(["member", "partner", "other"]);
    expect(fillersForSharing("LabMembers", [])).toEqual(["member"]);
    expect(fillersForSharing("Partners", [])).toEqual(["partner"]);
  });

  it("adds the kinds of people it's shared with by name", () => {
    expect(fillersForSharing("LabMembers", ["partner"])).toEqual(["member", "partner"]);
    expect(fillersForSharing("Partners", ["partner"])).toEqual(["partner"]);
  });

  it("a restricted form is filled by whoever it's shared with", () => {
    expect(fillersForSharing("Restricted", ["partner", "other"])).toEqual(["partner", "other"]);
  });

  it("a restricted form shared with nobody counts as lab members (its editors)", () => {
    expect(fillersForSharing("Restricted", [])).toEqual(["member"]);
  });
});

describe("prefillReach", () => {
  it("is all when every possible filler is covered", () => {
    expect(prefillReach("me.name", ["member", "partner"])).toEqual({ reach: "all" });
    expect(prefillReach("partnerOrg.name", ["partner"])).toEqual({ reach: "all" });
  });

  it("names who gets a blank when some fillers aren't covered", () => {
    expect(prefillReach("partnerOrg.name", ["member", "partner", "other"])).toEqual({
      reach: "some",
      blankFor: "lab members and other signed-in people",
    });
    expect(prefillReach("me.email", ["member", "anonymous"])).toEqual({
      reach: "some",
      blankFor: "people who aren't signed in",
    });
  });

  it("is none when no possible filler is covered", () => {
    expect(prefillReach("partnerOrg.name", ["member"])).toEqual({ reach: "none" });
  });
});
