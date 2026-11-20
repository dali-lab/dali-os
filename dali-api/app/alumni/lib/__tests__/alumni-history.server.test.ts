import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/partners/lib/partner-notify.server", () => ({ partnerNotifyRecipients: vi.fn() }));

import { mockedPrisma } from "~/test-utils/prisma";
import { notify } from "~/lib/notify.server";
import { partnerNotifyRecipients } from "~/partners/lib/partner-notify.server";
import { reportHistoryCorrection } from "../alumni-history.server";

const db = mockedPrisma();

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" } as never);
  vi.mocked(partnerNotifyRecipients).mockResolvedValue(["core1", "core2"]);
});

describe("reportHistoryCorrection", () => {
  it("notifies every active Core member with the note and a link to the member", async () => {
    expect(await reportHistoryCorrection("u1", "  Also on Rauner Archive in 24W  ")).toBe(true);
    expect(notify).toHaveBeenCalledWith({
      eventType: "alumni.history_correction",
      createdByUserId: "u1",
      message: {
        title: "Ada Lovelace reported a fix to their DALI history",
        body: "Also on Rauner Archive in 24W",
        link: "/members/u1",
      },
      recipients: [{ userId: "core1" }, { userId: "core2" }],
    });
  });

  it("sends nothing for an empty note", async () => {
    expect(await reportHistoryCorrection("u1", "   ")).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(partnerNotifyRecipients).not.toHaveBeenCalled();
  });

  it("caps the note at 1000 characters", async () => {
    await reportHistoryCorrection("u1", "x".repeat(1500));
    expect(vi.mocked(notify).mock.calls[0][0].message.body).toHaveLength(1000);
  });

  it("sends nothing when there is no one in Core to tell", async () => {
    vi.mocked(partnerNotifyRecipients).mockResolvedValue([]);
    expect(await reportHistoryCorrection("u1", "Missing a term")).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
