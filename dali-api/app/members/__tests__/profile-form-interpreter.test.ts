import { describe, it, expect } from "vitest";
import { interpretProfileForm } from "~/members/lib/profile-form-interpreter";

describe("interpretProfileForm", () => {
  it("maps known profile keys onto User fields", () => {
    const res = interpretProfileForm({
      "profile.pronouns": "they/them",
      "profile.major": "Computer Science",
      "profile.hometown": "Hanover, NH",
      "profile.githubUsername": "octocat",
      "profile.linkedinUrl": "https://linkedin.com/in/x",
      "profile.photoUrl": "https://x.dev/me.jpg",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({
      pronouns: "they/them",
      major: "Computer Science",
      hometown: "Hanover, NH",
      githubUsername: "octocat",
      linkedinUrl: "https://linkedin.com/in/x",
      photoUrl: "https://x.dev/me.jpg",
    });
  });

  it("ignores profile.personalSite (field removed)", () => {
    const res = interpretProfileForm({
      "profile.major": "Math",
      "profile.personalSite": "https://x.dev",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({ major: "Math" });
  });

  it("parses a valid class year", () => {
    const res = interpretProfileForm({ "profile.classYear": "2027" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({ classYear: 2027 });
  });

  it("rejects a non-4-digit class year", () => {
    const res = interpretProfileForm({ "profile.classYear": "27" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/4-digit/);
  });

  it("skips blank answers so existing fields aren't wiped", () => {
    const res = interpretProfileForm({
      "profile.pronouns": "   ",
      "profile.major": "",
      "profile.hometown": "Boston",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({ hometown: "Boston" });
  });

  it("ignores unknown keys", () => {
    const res = interpretProfileForm({
      "profile.major": "Math",
      "q-random": "whatever",
      somethingElse: "x",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({ major: "Math" });
  });

  it("returns an empty update for no relevant answers", () => {
    const res = interpretProfileForm({ "q-1": "a", "q-2": "b" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({});
  });

  it("maps the new onboarding profile fields", () => {
    // The legacy "profile.collegeId" answer key now maps to User.netId — the
    // two columns were consolidated. Existing form versions don't need to be
    // re-published; the destination column moved.
    const res = interpretProfileForm({
      "profile.nameOnFile": "Jonathan Doe",
      "profile.collegeId": "F00ABCD",
      "profile.phoneNumber": "+1 555 010 1234",
      "profile.ethnicity": "Asian",
      "profile.dietaryRestrictions": "Vegetarian",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({
      nameOnFile: "Jonathan Doe",
      netId: "F00ABCD",
      phoneNumber: "+1 555 010 1234",
      ethnicity: "Asian",
      dietaryRestrictions: "Vegetarian",
    });
  });

  it("parses a valid birthday into a UTC-midnight Date", () => {
    const res = interpretProfileForm({ "profile.birthday": "2004-09-15" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update.birthday).toBeInstanceOf(Date);
    expect(res.update.birthday?.toISOString()).toBe("2004-09-15T00:00:00.000Z");
  });

  it("rejects a malformed birthday", () => {
    const res = interpretProfileForm({ "profile.birthday": "Sept 15 2004" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/valid date/);
  });

  it("rejects an impossible birthday date", () => {
    const res = interpretProfileForm({ "profile.birthday": "2004-13-40" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/valid date/);
  });

  it("rejects an impossible-but-shaped birthday (Feb 31)", () => {
    const res = interpretProfileForm({ "profile.birthday": "2004-02-31" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/valid date/);
  });

  it("skips a blank birthday without error", () => {
    const res = interpretProfileForm({ "profile.birthday": "", "profile.major": "CS" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.update).toEqual({ major: "CS" });
  });
});
