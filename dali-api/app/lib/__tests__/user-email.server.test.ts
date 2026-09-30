import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/dartmouth-people", () => ({
  findNetIdByAddress: vi.fn(async () => null),
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    userEmail: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { findNetIdByAddress } from "~/lib/dartmouth-people";
import {
  normalizeEmailAddress,
  resolveLoginIdentifier,
  recordUserEmail,
  markEmailProven,
} from "~/lib/user-email.server";

const findAlias = vi.mocked(prisma.userEmail.findUnique);
const findUser = vi.mocked(prisma.user.findFirst);
const findByNetId = vi.mocked(prisma.user.findUnique);
const lookupNetId = vi.mocked(findNetIdByAddress);

beforeEach(() => {
  vi.clearAllMocks();
  findAlias.mockResolvedValue(null as never);
  findUser.mockResolvedValue(null as never);
  findByNetId.mockResolvedValue(null as never);
  lookupNetId.mockResolvedValue(null);
});

describe("normalizeEmailAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmailAddress("  Alex.T.Rivera.27@Dartmouth.EDU ")).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
  });
});

describe("resolveLoginIdentifier", () => {
  it("maps an alias to the account's canonical address", async () => {
    // The bug this exists to fix: a CAS-era student types the name-form address
    // their row has never held, and it must still reach their account.
    findAlias.mockResolvedValue({
      user: { email: "d99999z@dartmouth.edu" },
    } as never);

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "d99999z@dartmouth.edu",
    );
    expect(findAlias).toHaveBeenCalledWith(
      expect.objectContaining({ where: { address: "alex.t.rivera.27@dartmouth.edu" } }),
    );
  });

  it("is idempotent, so resolving an already-canonical address is a fixed point", async () => {
    // Both the /login action and the BetterAuth before-hook resolve. Applying
    // it twice must not drift.
    findAlias.mockResolvedValue({
      user: { email: "d99999z@dartmouth.edu" },
    } as never);

    const once = await resolveLoginIdentifier("d99999z@dartmouth.edu");
    const twice = await resolveLoginIdentifier(once);
    expect(twice).toBe(once);
  });

  it("falls back to the legacy address columns when no alias row exists", async () => {
    findUser.mockResolvedValue({ email: "canonical@dali.dartmouth.edu" } as never);

    expect(await resolveLoginIdentifier("someone@dartmouth.edu")).toBe(
      "canonical@dali.dartmouth.edu",
    );
  });

  it("returns the typed address unchanged when it resolves to nobody", async () => {
    // Anti-enumeration: the caller must stay neutral, so an unknown address
    // flows through and the downstream disableSignUp no-op handles it.
    expect(await resolveLoginIdentifier("Stranger@dartmouth.edu")).toBe(
      "stranger@dartmouth.edu",
    );
  });

  it("falls through when the matched account has no canonical email", async () => {
    findAlias.mockResolvedValue({ user: { email: null } } as never);
    findUser.mockResolvedValue(null as never);

    expect(await resolveLoginIdentifier("orphan@dartmouth.edu")).toBe(
      "orphan@dartmouth.edu",
    );
  });
});

describe("recordUserEmail", () => {
  it("creates an unproven row by default", async () => {
    await recordUserEmail({ userId: "u1", address: "D99999Z@dartmouth.edu" });

    expect(prisma.userEmail.create).toHaveBeenCalledWith({
      data: { userId: "u1", address: "d99999z@dartmouth.edu", verifiedAt: null },
    });
  });

  it("refuses to move an address that belongs to someone else", async () => {
    // Two rows claiming one mailbox is a real identity conflict. Re-pointing it
    // would hand one person's mail to the other.
    findAlias.mockResolvedValue({ userId: "other", verifiedAt: null } as never);

    const result = await recordUserEmail({ userId: "u1", address: "shared@dartmouth.edu" });

    expect(result).toEqual({ ok: false, conflictUserId: "other" });
    expect(prisma.userEmail.create).not.toHaveBeenCalled();
  });

  it("upgrades an existing row to proven without duplicating it", async () => {
    findAlias.mockResolvedValue({ userId: "u1", verifiedAt: null } as never);

    const result = await recordUserEmail({
      userId: "u1",
      address: "jane@dartmouth.edu",
      verified: true,
    });

    expect(result).toEqual({ ok: true, created: false });
    expect(prisma.userEmail.create).not.toHaveBeenCalled();
    expect(prisma.userEmail.update).toHaveBeenCalled();
  });

  it("never clears proof on an unproven re-record", async () => {
    // A directory sweep re-run must not downgrade a mailbox someone proved.
    const proven = new Date("2026-01-01");
    findAlias.mockResolvedValue({ userId: "u1", verifiedAt: proven } as never);

    await recordUserEmail({ userId: "u1", address: "jane@dartmouth.edu" });

    expect(prisma.userEmail.update).not.toHaveBeenCalled();
  });
});

describe("markEmailProven", () => {
  it("only touches rows that are not already proven", async () => {
    await markEmailProven("Jane@Dartmouth.edu");

    expect(prisma.userEmail.updateMany).toHaveBeenCalledWith({
      where: { address: "jane@dartmouth.edu", verifiedAt: null },
      data: { verifiedAt: expect.any(Date) },
    });
  });
});

describe("resolveLoginIdentifier — self-heal", () => {
  it("attaches an unknown @dartmouth address to the account that owns it", async () => {
    // The case the migration cannot cover: a CAS-era row holds only the
    // synthesized netid form, so the address the student types is unknown until
    // something teaches us about it. Waiting for the batch sweep would leave
    // whoever signs in first still locked out.
    lookupNetId.mockResolvedValue("d99999z");
    findByNetId.mockResolvedValue({
      id: "u1",
      email: "d99999z@dartmouth.edu",
    } as never);

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "d99999z@dartmouth.edu",
    );
    expect(prisma.userEmail.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        address: "alex.t.rivera.27@dartmouth.edu",
        verifiedAt: null,
      },
    });
  });

  it("does not consult the directory for a non-Dartmouth address", async () => {
    expect(await resolveLoginIdentifier("someone@gmail.com")).toBe("someone@gmail.com");
    expect(lookupNetId).not.toHaveBeenCalled();
  });

  it("stays neutral when the netid belongs to no account here", async () => {
    // Resolution must not invent accounts; that is sign-up's job.
    lookupNetId.mockResolvedValue("d99999z");
    findByNetId.mockResolvedValue(null as never);

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
    expect(prisma.userEmail.create).not.toHaveBeenCalled();
  });

  it("falls through without throwing when the directory is down", async () => {
    // A sign-in attempt must not 500 because Dartmouth is unreachable.
    lookupNetId.mockRejectedValue(new Error("ECONNRESET"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
    spy.mockRestore();
  });

  it("refuses to attach an address already held by another account", async () => {
    lookupNetId.mockResolvedValue("d99999z");
    findByNetId.mockResolvedValue({ id: "u1", email: "d99999z@dartmouth.edu" } as never);
    // Unknown when resolution looks it up, then found under another owner when
    // the heal tries to attach it — the ordering a real race would produce.
    findAlias
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ userId: "someone-else", verifiedAt: null } as never);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
    spy.mockRestore();
  });
});

describe("resolveLoginIdentifier — adopting a canonical address", () => {
  it("adopts the attested address when the account has no canonical email", async () => {
    // Observed in prod: a row holding a real address but a null User.email.
    // Resolution returns that column, so an alias cannot rescue it and neither
    // the sweep nor a plain heal helps — the row can never be sent a code.
    lookupNetId.mockResolvedValue("d99999z");
    findByNetId.mockResolvedValue({ id: "u1", email: null } as never);

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { email: "alex.t.rivera.27@dartmouth.edu" },
    });
  });

  it("never overwrites a canonical email that is already set", async () => {
    lookupNetId.mockResolvedValue("d99999z");
    findByNetId.mockResolvedValue({ id: "u1", email: "d99999z@dartmouth.edu" } as never);

    await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("stays neutral when another account already claims it as canonical", async () => {
    lookupNetId.mockResolvedValue("d99999z");
    findByNetId.mockResolvedValue({ id: "u1", email: null } as never);
    vi.mocked(prisma.user.update).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await resolveLoginIdentifier("alex.t.rivera.27@dartmouth.edu")).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
    spy.mockRestore();
  });
});
