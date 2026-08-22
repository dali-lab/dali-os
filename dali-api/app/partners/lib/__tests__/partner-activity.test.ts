import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  logPartnerActivity,
  setApplicationStatus,
  type ActivityDb,
} from "../partner-activity.server";

function makeDb() {
  const db = {
    partnerApplication: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    partnerActivity: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return db as unknown as ActivityDb & typeof db;
}

describe("logPartnerActivity", () => {
  it("omits the metadata key when none is provided", async () => {
    const db = makeDb();
    await logPartnerActivity(db, {
      applicationId: "a1",
      actorUserId: null,
      type: "Note",
      body: "hello",
    });
    expect(db.partnerActivity.create).toHaveBeenCalledTimes(1);
    const data = db.partnerActivity.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      applicationId: "a1",
      actorUserId: null,
      type: "Note",
      body: "hello",
    });
    expect("metadata" in data).toBe(false);
  });
});

describe("setApplicationStatus", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it("updates and logs a StatusChanged when the status moves", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ status: "Inquiry" });
    const prev = await setApplicationStatus(db, {
      applicationId: "a1",
      to: "Triaged",
      actorUserId: "u1",
    });
    expect(prev).toBe("Inquiry");
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { status: "Triaged" },
    });
    expect(db.partnerActivity.create).toHaveBeenCalledTimes(1);
    expect(db.partnerActivity.create.mock.calls[0][0].data).toMatchObject({
      applicationId: "a1",
      actorUserId: "u1",
      type: "StatusChanged",
      metadata: { from: "Inquiry", to: "Triaged" },
    });
  });

  it("still updates but does NOT log when the status is unchanged", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ status: "Meeting" });
    const prev = await setApplicationStatus(db, {
      applicationId: "a1",
      to: "Meeting",
      actorUserId: "u1",
    });
    expect(prev).toBe("Meeting");
    expect(db.partnerApplication.update).toHaveBeenCalledTimes(1);
    expect(db.partnerActivity.create).not.toHaveBeenCalled();
  });

  it("merges extra data fields and metadata keys", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ status: "UnderReview" });
    await setApplicationStatus(db, {
      applicationId: "a1",
      to: "Rejected",
      actorUserId: "u1",
      data: { decisionReason: "not enough scope" },
      meta: { reason: "not enough scope" },
    });
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { status: "Rejected", decisionReason: "not enough scope" },
    });
    expect(db.partnerActivity.create.mock.calls[0][0].data.metadata).toEqual({
      from: "UnderReview",
      to: "Rejected",
      reason: "not enough scope",
    });
  });

  it("returns null and writes nothing when the application is gone", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    const prev = await setApplicationStatus(db, {
      applicationId: "missing",
      to: "Triaged",
    });
    expect(prev).toBeNull();
    expect(db.partnerApplication.update).not.toHaveBeenCalled();
    expect(db.partnerActivity.create).not.toHaveBeenCalled();
  });
});
