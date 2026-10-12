import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mailMessageIndex: { findMany: vi.fn(), createMany: vi.fn() },
    partnerContact: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/user-email.server", () => ({ findUserIdsByAddresses: vi.fn() }));

import { prisma } from "~/lib/db";
import { findUserIdsByAddresses } from "~/lib/user-email.server";
import { PARTNERS_FROM_EMAIL } from "~/lib/app-env";
import { parseAddressList } from "~/email/lib/address-list";
import {
  classifyDirection,
  counterpartAddresses,
  indexMessages,
  type IndexableMessage,
} from "~/email/lib/mail-index.server";

const db = prisma as unknown as {
  mailMessageIndex: Record<string, ReturnType<typeof vi.fn>>;
  partnerContact: Record<string, ReturnType<typeof vi.fn>>;
};
const INBOX = "applications@dali.dartmouth.edu";

beforeEach(() => {
  vi.clearAllMocks();
  db.mailMessageIndex.findMany.mockResolvedValue([]);
  db.mailMessageIndex.createMany.mockResolvedValue({ count: 0 });
  db.partnerContact.findMany.mockResolvedValue([]);
  vi.mocked(findUserIdsByAddresses).mockResolvedValue(new Map());
});

describe("parseAddressList", () => {
  it("splits multiple recipients and strips display names", () => {
    expect(parseAddressList('"Ada Lovelace" <ada@x.com>, grace@y.com')).toEqual([
      "ada@x.com",
      "grace@y.com",
    ]);
  });

  it("doesn't split on a comma inside a quoted display name", () => {
    expect(parseAddressList('"Lovelace, Ada" <ada@x.com>')).toEqual(["ada@x.com"]);
  });

  it("drops empties and lowercases", () => {
    expect(parseAddressList(" , ADA@X.COM ,")).toEqual(["ada@x.com"]);
  });
});

describe("classifyDirection", () => {
  it("is Outbound when the SENT label is present", () => {
    expect(classifyDirection({ labelIds: ["SENT"], from: "someone@else.com" }, INBOX)).toBe("Outbound");
  });

  it("is Outbound when the sender is the inbox itself", () => {
    expect(classifyDirection({ labelIds: [], from: `"Apps" <${INBOX}>` }, INBOX)).toBe("Outbound");
  });

  it("is Inbound otherwise", () => {
    expect(classifyDirection({ labelIds: [], from: "ada@x.com" }, INBOX)).toBe("Inbound");
  });
});

describe("counterpartAddresses", () => {
  it("Inbound: just the sender", () => {
    expect(
      counterpartAddresses("Inbound", { from: "ada@x.com", to: INBOX, cc: "" }, INBOX),
    ).toEqual(["ada@x.com"]);
  });

  it("Outbound: To then Cc, minus the inbox address, deduped", () => {
    expect(
      counterpartAddresses(
        "Outbound",
        { from: INBOX, to: `ada@x.com, ${INBOX}`, cc: "ada@x.com, grace@y.com" },
        INBOX,
      ),
    ).toEqual(["ada@x.com", "grace@y.com"]);
  });
});

function meta(overrides: Partial<IndexableMessage> = {}): IndexableMessage {
  return {
    id: "m1",
    threadId: "t1",
    direction: "Inbound",
    subject: "Hi",
    date: "2026-01-01T00:00:00.000Z",
    from: "ada@x.com",
    to: INBOX,
    cc: "",
    ...overrides,
  };
}

describe("indexMessages", () => {
  it("auto-links to the resolved counterpart when no Manual link exists for the thread", async () => {
    vi.mocked(findUserIdsByAddresses).mockResolvedValue(new Map([["ada@x.com", "u1"]]));

    await indexMessages({ accountId: "acc1", inboxAddress: INBOX, metas: [meta()] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: "u1", linkSource: "Auto" });
    expect(db.mailMessageIndex.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("inherits a thread's Manual link for a new message in that thread", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([{ threadId: "t1", linkedUserId: "u-manual" }]);
    vi.mocked(findUserIdsByAddresses).mockResolvedValue(new Map([["ada@x.com", "u-auto"]]));

    await indexMessages({ accountId: "acc1", inboxAddress: INBOX, metas: [meta()] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: "u-manual", linkSource: "Manual" });
  });

  it("inherits an explicit Manual unlink (null) rather than falling back to Auto", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([{ threadId: "t1", linkedUserId: null }]);
    vi.mocked(findUserIdsByAddresses).mockResolvedValue(new Map([["ada@x.com", "u-auto"]]));

    await indexMessages({ accountId: "acc1", inboxAddress: INBOX, metas: [meta()] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: null, linkSource: "Manual" });
  });

  it("links to None when nothing resolves and no Manual link exists", async () => {
    await indexMessages({ accountId: "acc1", inboxAddress: INBOX, metas: [meta()] });
    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: null, linkSource: "None" });
  });

  it("short-circuits on an empty batch", async () => {
    const created = await indexMessages({ accountId: "acc1", inboxAddress: INBOX, metas: [] });
    expect(created).toBe(0);
    expect(db.mailMessageIndex.createMany).not.toHaveBeenCalled();
  });
});

describe("indexMessages: partner contact linking", () => {
  it("does not look up PartnerContact for a non-partners inbox", async () => {
    await indexMessages({ accountId: "acc1", inboxAddress: INBOX, metas: [meta()] });
    expect(db.partnerContact.findMany).not.toHaveBeenCalled();
  });

  it("auto-links the partners@ inbox to a resolved PartnerContact when no User matches", async () => {
    db.partnerContact.findMany.mockResolvedValue([{ id: "pc1", email: "ada@x.com" }]);

    await indexMessages({ accountId: "acc1", inboxAddress: PARTNERS_FROM_EMAIL, metas: [meta({ to: PARTNERS_FROM_EMAIL })] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: null, linkedPartnerContactId: "pc1", linkSource: "Auto" });
  });

  it("prefers a User match over a PartnerContact match on the partners@ inbox", async () => {
    vi.mocked(findUserIdsByAddresses).mockResolvedValue(new Map([["ada@x.com", "u1"]]));
    db.partnerContact.findMany.mockResolvedValue([{ id: "pc1", email: "ada@x.com" }]);

    await indexMessages({ accountId: "acc1", inboxAddress: PARTNERS_FROM_EMAIL, metas: [meta({ to: PARTNERS_FROM_EMAIL })] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: "u1", linkedPartnerContactId: null, linkSource: "Auto" });
  });

  it("looks up PartnerContact off a non-partners address when linkPartnerContacts is passed explicitly", async () => {
    db.partnerContact.findMany.mockResolvedValue([{ id: "pc1", email: "ada@x.com" }]);

    await indexMessages({
      accountId: "acc1",
      inboxAddress: INBOX,
      metas: [meta()],
      linkPartnerContacts: true,
    });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedPartnerContactId: "pc1", linkSource: "Auto" });
  });

  it("inherits a thread's Manual PartnerContact link for a new message in that thread", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      { threadId: "t1", linkedUserId: null, linkedPartnerContactId: "pc-manual" },
    ]);
    db.partnerContact.findMany.mockResolvedValue([{ id: "pc-auto", email: "ada@x.com" }]);

    await indexMessages({ accountId: "acc1", inboxAddress: PARTNERS_FROM_EMAIL, metas: [meta({ to: PARTNERS_FROM_EMAIL })] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: null, linkedPartnerContactId: "pc-manual", linkSource: "Manual" });
  });

  it("links to None on the partners@ inbox when neither a User nor a PartnerContact resolves", async () => {
    await indexMessages({ accountId: "acc1", inboxAddress: PARTNERS_FROM_EMAIL, metas: [meta({ to: PARTNERS_FROM_EMAIL })] });

    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ linkedUserId: null, linkedPartnerContactId: null, linkSource: "None" });
  });
});
