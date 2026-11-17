import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    userEmail: { findUnique: vi.fn() },
    verification: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    auditLog: { count: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "ob1", deduped: false })),
  drainNow: vi.fn(),
}));
vi.mock("~/lib/user-email.server", () => ({
  normalizeEmailAddress: (s: string) => s.trim().toLowerCase(),
  recordUserEmail: vi.fn(async () => ({ ok: true, created: true })),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { recordUserEmail } from "~/lib/user-email.server";
import {
  ADDRESS_ON_OTHER_ACCOUNT,
  CONTACT_CODE_MAX_ATTEMPTS,
  chooseContactEmail,
  confirmContactEmail,
  listContactEmailOptions,
  runContactEmailIntent,
} from "~/lib/contact-email.server";

const db = vi.mocked(prisma, true);
const record = vi.mocked(recordUserEmail);

let stored: { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date } | null;

function user(over: Record<string, unknown> = {}) {
  return { email: "ada@dali.dartmouth.edu", emails: [], ...over };
}

function codeFromMail(): string {
  const text = vi.mocked(enqueueOutbound).mock.calls.at(-1)![0].bodyText!;
  return text.match(/\b\d{6}\b/)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = null;
  db.user.findUnique.mockResolvedValue(user() as never);
  db.user.findFirst.mockResolvedValue(null as never);
  db.userEmail.findUnique.mockResolvedValue(null as never);
  db.auditLog.count.mockResolvedValue(0 as never);
  db.verification.findFirst.mockImplementation((async ({ where }: { where: { identifier: string | { startsWith: string } } }) => {
    const id = where.identifier;
    const match = typeof id === "string" ? stored?.identifier === id : stored?.identifier.startsWith(id.startsWith);
    return match ? stored : null;
  }) as never);
  db.verification.create.mockImplementation((async ({ data }: { data: { identifier: string; value: string; expiresAt: Date } }) => {
    stored = { id: "v1", createdAt: new Date(), ...data };
    return stored;
  }) as never);
  db.verification.deleteMany.mockImplementation((async () => {
    const count = stored ? 1 : 0;
    stored = null;
    return { count };
  }) as never);
  db.verification.updateMany.mockImplementation((async ({ data }: { data: { value: string } }) => {
    if (stored) stored.value = data.value;
    return { count: 1 };
  }) as never);
  record.mockResolvedValue({ ok: true, created: true });
});

describe("listContactEmailOptions", () => {
  it("lists every address once, marks proven and current, and hides the netid form", async () => {
    db.user.findUnique.mockResolvedValue({
      netId: "F00ABC1",
      email: "f00abc1@dartmouth.edu",
      personalEmail: "Ada@Example.com",
      daliEmail: "ada@dali.dartmouth.edu",
      dartmouthEmail: "f00abc1@dartmouth.edu",
      emails: [
        { address: "ada@dali.dartmouth.edu", verifiedAt: new Date("2026-01-01") },
        { address: "ada@example.com", verifiedAt: new Date("2026-06-01") },
        { address: "ada@alum.dartmouth.edu", verifiedAt: null },
      ],
    } as never);

    const { options, preselected } = await listContactEmailOptions("u1");

    expect(options.map((o) => o.address)).toEqual(["ada@example.com", "ada@dali.dartmouth.edu", "ada@alum.dartmouth.edu"]);
    expect(options.map((o) => o.proven)).toEqual([true, true, false]);
    expect(options.some((o) => o.current)).toBe(false);
    expect(preselected).toBe("ada@example.com");
  });

  it("marks the current login address and falls back to it when nothing is proven", async () => {
    db.user.findUnique.mockResolvedValue({
      netId: null,
      email: "ada@dali.dartmouth.edu",
      personalEmail: null,
      daliEmail: "ada@dali.dartmouth.edu",
      dartmouthEmail: null,
      emails: [],
    } as never);
    const { options, preselected } = await listContactEmailOptions("u1");
    expect(options).toEqual([{ address: "ada@dali.dartmouth.edu", proven: false, current: true }]);
    expect(preselected).toBe("ada@dali.dartmouth.edu");
  });

  it("returns nothing for an unknown user", async () => {
    db.user.findUnique.mockResolvedValue(null as never);
    expect(await listContactEmailOptions("u1")).toEqual({ options: [], preselected: null });
  });
});

describe("chooseContactEmail", () => {
  it("rejects an address that is not an email", async () => {
    await expect(chooseContactEmail({ userId: "u1", address: "nope" })).rejects.toThrow("Enter a valid email address.");
  });

  it("does nothing when the address is already the login email", async () => {
    expect(await chooseContactEmail({ userId: "u1", address: " ADA@dali.dartmouth.edu " })).toEqual({ status: "unchanged" });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("switches at once to an address this user already proved, and keeps the old one as an alias", async () => {
    db.user.findUnique.mockResolvedValue(user({ emails: [{ verifiedAt: new Date() }] }) as never);
    db.userEmail.findUnique.mockResolvedValue({ userId: "u1" } as never);

    const result = await chooseContactEmail({ userId: "u1", address: "Ada@Example.com" });

    expect(result).toEqual({ status: "switched" });
    expect(record).toHaveBeenCalledWith({ userId: "u1", address: "ada@example.com", verified: true });
    expect(record).toHaveBeenCalledWith({ userId: "u1", address: "ada@dali.dartmouth.edu" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { email: "ada@example.com", emailVerified: true },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "account.contact_email.change", userId: "u1" }));
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("sends a code instead of switching when the address is not proven", async () => {
    const result = await chooseContactEmail({ userId: "u1", address: "ada@example.com" });

    expect(result).toEqual({ status: "code_sent" });
    expect(db.user.update).not.toHaveBeenCalled();
    const mail = vi.mocked(enqueueOutbound).mock.calls[0][0];
    expect(mail).toMatchObject({ target: "ada@example.com", recipientUserId: "u1", subject: "Your DALI OS email change code" });
    expect(mail.dedupKey).not.toContain(codeFromMail());
    expect(drainNow).toHaveBeenCalledWith(["ob1"]);
    expect(stored!.value).not.toContain(codeFromMail());
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("refuses an address held by another account without sending anything", async () => {
    db.userEmail.findUnique.mockResolvedValue({ userId: "u2" } as never);
    await expect(chooseContactEmail({ userId: "u1", address: "bob@example.com" })).rejects.toThrow(ADDRESS_ON_OTHER_ACCOUNT);

    db.userEmail.findUnique.mockResolvedValue(null as never);
    db.user.findFirst.mockResolvedValue({ id: "u2" } as never);
    await expect(chooseContactEmail({ userId: "u1", address: "bob@example.com" })).rejects.toThrow(ADDRESS_ON_OTHER_ACCOUNT);
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(db.user.findFirst.mock.calls[0][0]!.where).toMatchObject({ id: { not: "u1" } });
  });

  it("throttles a second code inside a minute and caps codes per day", async () => {
    stored = { id: "v0", identifier: "contact-email:u1:old@example.com", value: "h:0", expiresAt: new Date(Date.now() + 1000), createdAt: new Date() };
    await expect(chooseContactEmail({ userId: "u1", address: "ada@example.com" })).rejects.toThrow("Wait a minute");

    stored = null;
    db.auditLog.count.mockResolvedValue(10 as never);
    await expect(chooseContactEmail({ userId: "u1", address: "ada@example.com" })).rejects.toThrow("Too many codes today");
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe("confirmContactEmail", () => {
  async function requestCode(address = "ada@example.com") {
    await chooseContactEmail({ userId: "u1", address });
    return codeFromMail();
  }

  it("switches to the address once the right code is entered, and the code works only once", async () => {
    const code = await requestCode();
    await confirmContactEmail({ userId: "u1", address: "ada@example.com", code });

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { email: "ada@example.com", emailVerified: true } });
    expect(record).toHaveBeenCalledWith({ userId: "u1", address: "ada@example.com", verified: true });
    expect(record).toHaveBeenCalledWith({ userId: "u1", address: "ada@dali.dartmouth.edu" });
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code })).rejects.toThrow("didn't work");
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const code = await requestCode();
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code: wrong })).rejects.toThrow("didn't match");
    expect(stored!.value.endsWith(":1")).toBe(true);
    expect(db.user.update).not.toHaveBeenCalled();
    await confirmContactEmail({ userId: "u1", address: "ada@example.com", code });
    expect(db.user.update).toHaveBeenCalled();
  });

  it("locks the code after five wrong tries, even if the right one follows", async () => {
    const code = await requestCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < CONTACT_CODE_MAX_ATTEMPTS - 1; i++) {
      await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code: wrong })).rejects.toThrow("didn't match");
    }
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code: wrong })).rejects.toThrow("Too many tries");
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code })).rejects.toThrow("didn't work");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an expired code", async () => {
    const code = await requestCode();
    stored!.expiresAt = new Date(Date.now() - 1000);
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code })).rejects.toThrow("expired");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("does not accept a code issued for a different address", async () => {
    const code = await requestCode("ada@example.com");
    await expect(confirmContactEmail({ userId: "u1", address: "other@example.com", code })).rejects.toThrow("didn't work");
  });

  it("rechecks ownership at confirmation time", async () => {
    const code = await requestCode();
    db.user.findFirst.mockResolvedValue({ id: "u2" } as never);
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code })).rejects.toThrow(ADDRESS_ON_OTHER_ACCOUNT);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("does not switch when recording the address hits a conflict", async () => {
    const code = await requestCode();
    record.mockResolvedValueOnce({ ok: false, conflictUserId: "u2" });
    await expect(confirmContactEmail({ userId: "u1", address: "ada@example.com", code })).rejects.toThrow(ADDRESS_ON_OTHER_ACCOUNT);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("runContactEmailIntent", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("ignores other intents", async () => {
    expect(await runContactEmailIntent("save-class", form({}), "u1")).toBeNull();
  });

  it("answers a choice with the status, and a code request with the normalized address", async () => {
    expect(await runContactEmailIntent("choose-contact-email", form({ address: "ada@dali.dartmouth.edu" }), "u1")).toEqual({
      ok: true,
      status: "unchanged",
    });
    expect(await runContactEmailIntent("choose-contact-email", form({ address: " Ada@Example.com" }), "u1")).toEqual({
      ok: true,
      status: "code_sent",
      address: "ada@example.com",
    });
  });

  it("turns a rejection into an error message and lets other errors through", async () => {
    expect(await runContactEmailIntent("choose-contact-email", form({ address: "nope" }), "u1")).toEqual({
      error: "Enter a valid email address.",
    });
    db.user.findUnique.mockRejectedValue(new Error("db down"));
    await expect(runContactEmailIntent("choose-contact-email", form({ address: "a@b.co" }), "u1")).rejects.toThrow("db down");
  });

  it("confirms with the posted code", async () => {
    await runContactEmailIntent("choose-contact-email", form({ address: "ada@example.com" }), "u1");
    const code = codeFromMail();
    expect(await runContactEmailIntent("confirm-contact-email", form({ address: "ada@example.com", code }), "u1")).toEqual({
      ok: true,
      status: "switched",
    });
  });
});
