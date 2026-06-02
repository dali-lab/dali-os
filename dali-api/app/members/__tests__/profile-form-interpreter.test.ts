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
});
