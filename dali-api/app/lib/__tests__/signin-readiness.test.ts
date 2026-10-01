import { describe, it, expect } from "vitest";
import {
  classifySignInReadiness,
  synthesizedAddress,
  preferredCanonicalEmail,
} from "~/lib/signin-readiness";

const base = {
  netId: null,
  email: null,
  daliEmail: null,
  dartmouthEmail: null,
  personalEmail: null,
  aliases: [] as string[],
};

describe("synthesizedAddress", () => {
  it("builds the netid form CAS used to invent", () => {
    expect(synthesizedAddress("D99999Z")).toBe("d99999z@dartmouth.edu");
  });

  it("is null without a netId", () => {
    expect(synthesizedAddress(null)).toBeNull();
  });
});

describe("classifySignInReadiness", () => {
  it("flags a CAS-era row holding only the synthesized address", () => {
    // The mini-series case. Nothing here looks broken — the address delivers,
    // so every notification we ever sent arrived. It just isn't one anybody
    // could type, so the code screen sends nothing and says nothing is wrong.
    const r = classifySignInReadiness({
      ...base,
      netId: "d99999z",
      email: "d99999z@dartmouth.edu",
      dartmouthEmail: "d99999z@dartmouth.edu",
      aliases: ["d99999z@dartmouth.edu"],
    });

    expect(r.verdict).toBe("locked-out");
    expect(r.human).toEqual([]);
  });

  it("clears the same row once a real address is attached", () => {
    const r = classifySignInReadiness({
      ...base,
      netId: "d99999z",
      email: "d99999z@dartmouth.edu",
      dartmouthEmail: "d99999z@dartmouth.edu",
      aliases: ["d99999z@dartmouth.edu", "alex.t.rivera.27@dartmouth.edu"],
    });

    expect(r.verdict).toBe("ok");
    expect(r.human).toEqual(["alex.t.rivera.27@dartmouth.edu"]);
  });

  it("clears a member whose canonical address is their real @dali one", () => {
    // Why members never noticed: upsertUserFromGoogle writes the address Google
    // gave it, so their canonical email is the one they type.
    const r = classifySignInReadiness({
      ...base,
      daliEmail: "alex.rivera@dali.dartmouth.edu",
      email: "alex.rivera@dali.dartmouth.edu",
      aliases: ["alex.rivera@dali.dartmouth.edu"],
    });

    expect(r.verdict).toBe("ok");
  });

  it("reports a null canonical email as unreachable even with aliases", () => {
    // Resolution returns User.email. Aliases point at a column with nothing in
    // it, so there is no identifier to hand BetterAuth.
    const r = classifySignInReadiness({
      ...base,
      dartmouthEmail: "alex.t.rivera.27@dartmouth.edu",
      aliases: ["alex.t.rivera.27@dartmouth.edu"],
    });

    expect(r.verdict).toBe("no-canonical");
  });

  it("separates a row with no address at all", () => {
    expect(classifySignInReadiness({ ...base, netId: "d99999z" }).verdict).toBe(
      "no-address",
    );
  });

  it("normalizes case and whitespace before comparing", () => {
    const r = classifySignInReadiness({
      ...base,
      netId: "D99999Z",
      email: "  D99999Z@Dartmouth.EDU ",
      aliases: ["D99999Z@DARTMOUTH.EDU"],
    });

    // Still just the synthesized address, spelled differently.
    expect(r.verdict).toBe("locked-out");
    expect(r.all).toEqual(["d99999z@dartmouth.edu"]);
  });

  it("names columns absent from the alias table", () => {
    const r = classifySignInReadiness({
      ...base,
      email: "alex.t.rivera.27@dartmouth.edu",
      personalEmail: "alex@example.com",
      aliases: ["alex.t.rivera.27@dartmouth.edu"],
    });

    expect(r.missingAliases).toEqual(["alex@example.com"]);
  });

  it("treats a netid-form personal address as synthesized too", () => {
    // Whichever column it landed in, it is the same unusable string.
    const r = classifySignInReadiness({
      ...base,
      netId: "d99999z",
      email: "d99999z@dartmouth.edu",
      personalEmail: "d99999z@dartmouth.edu",
    });

    expect(r.verdict).toBe("locked-out");
  });
});

describe("preferredCanonicalEmail", () => {
  const base = {
    netId: "d99999z",
    email: null as string | null,
    daliEmail: null as string | null,
    candidate: "alex.t.rivera.27@dartmouth.edu" as string | null,
  };

  it("replaces the synthesized address with the real one", () => {
    expect(
      preferredCanonicalEmail({ ...base, email: "d99999z@dartmouth.edu" }),
    ).toBe("alex.t.rivera.27@dartmouth.edu");
  });

  it("never lets a Dartmouth address displace a @dali one", () => {
    // A member's lab address is what the app displays and what they identify
    // with. Promoting over it demotes them for no gain.
    expect(
      preferredCanonicalEmail({
        ...base,
        email: "alex.rivera@dali.dartmouth.edu",
        daliEmail: "alex.rivera@dali.dartmouth.edu",
      }),
    ).toBeNull();
  });

  it("restores a @dali canonical that an earlier run demoted", () => {
    // The state a --promote run left members in: daliEmail intact, canonical
    // moved to their Dartmouth address. Re-running has to put it back, not
    // shrug because the row already holds every alias.
    expect(
      preferredCanonicalEmail({
        ...base,
        email: "alex.t.rivera.27@dartmouth.edu",
        daliEmail: "alex.rivera@dali.dartmouth.edu",
      }),
    ).toBe("alex.rivera@dali.dartmouth.edu");
  });

  it("leaves a usable non-dali canonical alone", () => {
    expect(
      preferredCanonicalEmail({ ...base, email: "alex@example.com" }),
    ).toBeNull();
  });

  it("adopts the candidate when there is no canonical at all", () => {
    expect(preferredCanonicalEmail({ ...base, email: null })).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
  });

  it("is a no-op when the canonical is already the candidate", () => {
    expect(
      preferredCanonicalEmail({ ...base, email: "Alex.T.Rivera.27@Dartmouth.edu" }),
    ).toBeNull();
  });

  it("does nothing without a candidate and without a dali address", () => {
    expect(
      preferredCanonicalEmail({ ...base, email: "d99999z@dartmouth.edu", candidate: null }),
    ).toBeNull();
  });
});
