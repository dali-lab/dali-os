import { describe, it, expect } from "vitest";
import {
  QUEST_FIELDS,
  questPercent,
  filledCount,
  nextQuestField,
  isQuestFieldKey,
  renderQuestion,
  toQuestProfile,
  type QuestProfile,
} from "../quest";

const empty = (): QuestProfile =>
  Object.fromEntries(QUEST_FIELDS.map((f) => [f.key, null])) as QuestProfile;

const baseUser = {
  firstName: "Ada",
  lastName: "Lovelace",
  personalEmail: null,
  classYear: null,
  currentLocation: null,
  hometown: null,
  major: null,
  minors: null,
  funFact: null,
  dietaryRestrictions: null,
  linkedinUrl: null,
  personalSite: null,
};

describe("quest fields", () => {
  it("has unique keys and a question for each", () => {
    const keys = QUEST_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of QUEST_FIELDS) {
      expect(f.question.length).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it("asks the required fields (name, email) first", () => {
    expect(QUEST_FIELDS[0]).toMatchObject({ key: "name", required: true });
    expect(QUEST_FIELDS[1]).toMatchObject({ key: "email", required: true });
    expect(QUEST_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(["name", "email"]);
  });

  it("covers the real onboarding checklist", () => {
    const keys = QUEST_FIELDS.map((f) => f.key);
    for (const key of [
      "name",
      "email",
      "classYear",
      "currentLocation",
      "work",
      "history",
      "funFact",
      "major",
      "minors",
      "hometown",
      "dietaryRestrictions",
      "linkedinUrl",
      "personalSite",
      "openTo",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("recognizes its own keys and rejects others", () => {
    expect(isQuestFieldKey("hometown")).toBe(true);
    expect(isQuestFieldKey("pronouns")).toBe(false);
    expect(isQuestFieldKey("walletPassSecret")).toBe(false);
    expect(isQuestFieldKey(undefined)).toBe(false);
  });
});

describe("renderQuestion", () => {
  it("fills the name and emails on file into the confirm questions", () => {
    const name = QUEST_FIELDS.find((f) => f.key === "name")!;
    const email = QUEST_FIELDS.find((f) => f.key === "email")!;
    expect(renderQuestion(name, { fullName: "Ada Lovelace" })).toContain("Ada Lovelace");
    expect(renderQuestion(email, { emails: ["a@x.com", "b@y.com"] })).toContain(
      "a@x.com, b@y.com",
    );
  });

  it("falls back to generic wording without context", () => {
    const name = QUEST_FIELDS.find((f) => f.key === "name")!;
    expect(renderQuestion(name)).toContain("what we have on file");
    expect(renderQuestion(name)).not.toContain("{name}");
    const email = QUEST_FIELDS.find((f) => f.key === "email")!;
    expect(renderQuestion(email)).not.toContain("{emails}");
  });
});

describe("questPercent", () => {
  it("is 0 when nothing is filled and 100 when everything is", () => {
    expect(questPercent(empty())).toBe(0);
    const full = Object.fromEntries(QUEST_FIELDS.map((f) => [f.key, "x"])) as QuestProfile;
    expect(questPercent(full)).toBe(100);
  });

  it("ignores whitespace-only values", () => {
    const p = empty();
    p.major = "   ";
    expect(filledCount(p)).toBe(0);
    p.major = "CS";
    expect(filledCount(p)).toBe(1);
    expect(questPercent(p)).toBe(Math.round(100 / QUEST_FIELDS.length));
  });
});

describe("nextQuestField", () => {
  it("asks fields in order, skipping filled ones", () => {
    const p = empty();
    expect(nextQuestField(p)?.key).toBe("name");
    p.name = "Ada Lovelace";
    expect(nextQuestField(p)?.key).toBe("email");
  });

  it("never skips a required field, and runs out once optionals are skipped", () => {
    const p = empty();
    const skippedAll = QUEST_FIELDS.map((f) => f.key);
    expect(nextQuestField(p, skippedAll)?.key).toBe("name");
    p.name = "Ada Lovelace";
    expect(nextQuestField(p, skippedAll)?.key).toBe("email");
    p.email = "ada@x.com";
    expect(nextQuestField(p, skippedAll)).toBeNull();
  });
});

describe("toQuestProfile", () => {
  it("passes text columns through and stringifies classYear", () => {
    const profile = toQuestProfile({
      user: { ...baseUser, classYear: 2019, hometown: "Austin" },
      confirmed: [],
      hasWork: false,
    });
    expect(profile.classYear).toBe("2019");
    expect(profile.hometown).toBe("Austin");
    expect(profile.major).toBeNull();
    expect(profile.linkedinUrl).toBeNull();
  });

  it("fills confirm-kind fields only once their key is confirmed", () => {
    const before = toQuestProfile({ user: baseUser, confirmed: [], hasWork: false });
    expect(before.name).toBeNull();
    expect(before.email).toBeNull();
    expect(before.history).toBeNull();
    expect(before.openTo).toBeNull();
    const after = toQuestProfile({
      user: { ...baseUser, personalEmail: "ada@x.com" },
      confirmed: ["name", "email", "history", "openTo"],
      hasWork: false,
    });
    expect(after.name).toBe("Ada Lovelace");
    expect(after.email).toBe("ada@x.com");
    expect(after.history).toBe("confirmed");
    expect(after.openTo).toBe("confirmed");
  });

  it("counts work filled from a confirmation or an existing work experience row", () => {
    expect(toQuestProfile({ user: baseUser, confirmed: [], hasWork: true }).work).toBe("on file");
    expect(toQuestProfile({ user: baseUser, confirmed: ["work"], hasWork: false }).work).toBe(
      "on file",
    );
    expect(toQuestProfile({ user: baseUser, confirmed: [], hasWork: false }).work).toBeNull();
  });

  it("keeps a null classYear null", () => {
    expect(
      toQuestProfile({ user: baseUser, confirmed: [], hasWork: false }).classYear,
    ).toBeNull();
  });
});
