import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  logPartnerActivity,
  setApplicationStage,
  type ActivityDb,
} from "../partner-activity.server";

function makeDb() {
  const db = {
    partnerApplication: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      aggregate: vi.fn().mockResolvedValue({ _min: { position: null } }),
    },
    partnerActivity: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return db as unknown as ActivityDb & typeof db;
}

describe("logPartnerActivity", () => {
  it("omits the metadata key when none is provided and stamps lastActivityAt", async () => {
    const db = makeDb();
    db.partnerApplication.findUnique.mockResolvedValue({
      partnerOrgId: "org1",
      applicantContactId: "pc1",
    });
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
    expect(db.partnerApplication.updateMany).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { lastActivityAt: expect.any(Date) },
    });
  });

  it("copies the application's org and contact onto the row", async () => {
    const db = makeDb();
    db.partnerApplication.findUnique.mockResolvedValue({
      partnerOrgId: "org1",
      applicantContactId: "pc1",
    });
    await logPartnerActivity(db, { applicationId: "a1", type: "Created" });
    expect(db.partnerActivity.create.mock.calls[0][0].data).toMatchObject({
      orgId: "org1",
      contactId: "pc1",
    });
  });

  it("logs org-level events with no application and no lookup", async () => {
    const db = makeDb();
    await logPartnerActivity(db, {
      orgId: "org1",
      actorUserId: "u1",
      type: "ProjectLinked",
      metadata: { projectId: "p1" },
    });
    expect(db.partnerApplication.findUnique).not.toHaveBeenCalled();
    expect(db.partnerApplication.updateMany).not.toHaveBeenCalled();
    expect(db.partnerActivity.create.mock.calls[0][0].data).toMatchObject({
      applicationId: null,
      orgId: "org1",
      contactId: null,
      type: "ProjectLinked",
    });
  });
});

describe("setApplicationStage", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it("updates, places the card at the top of the new column, and logs StatusChanged", async () => {
    db.partnerApplication.findUnique
      .mockResolvedValueOnce({ stage: "New" })
      .mockResolvedValue({ partnerOrgId: null, applicantContactId: "pc1" });
    db.partnerApplication.aggregate.mockResolvedValue({ _min: { position: 0 } });
    const prev = await setApplicationStage(db, {
      applicationId: "a1",
      to: "Interview",
      actorUserId: "u1",
    });
    expect(prev).toBe("New");
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { stage: "Interview", position: -1 },
    });
    expect(db.partnerActivity.create).toHaveBeenCalledTimes(1);
    expect(db.partnerActivity.create.mock.calls[0][0].data).toMatchObject({
      applicationId: "a1",
      actorUserId: "u1",
      type: "StatusChanged",
      metadata: { from: "New", to: "Interview" },
    });
  });

  it("still updates but does NOT log or reposition when the stage is unchanged", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ stage: "Interview" });
    const prev = await setApplicationStage(db, {
      applicationId: "a1",
      to: "Interview",
      actorUserId: "u1",
    });
    expect(prev).toBe("Interview");
    expect(db.partnerApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { stage: "Interview" },
    });
    expect(db.partnerApplication.aggregate).not.toHaveBeenCalled();
    expect(db.partnerActivity.create).not.toHaveBeenCalled();
  });

  it("merges extra data fields and metadata keys", async () => {
    db.partnerApplication.findUnique
      .mockResolvedValueOnce({ stage: "Interview" })
      .mockResolvedValue({ partnerOrgId: null, applicantContactId: "pc1" });
    await setApplicationStage(db, {
      applicationId: "a1",
      to: "Rejected",
      actorUserId: "u1",
      data: { decisionReason: "not enough scope", rejectReason: "NotAFit" },
      meta: { reason: "not enough scope" },
    });
    expect(db.partnerApplication.update.mock.calls[0][0].data).toMatchObject({
      stage: "Rejected",
      decisionReason: "not enough scope",
      rejectReason: "NotAFit",
    });
    expect(db.partnerActivity.create.mock.calls[0][0].data.metadata).toEqual({
      from: "Interview",
      to: "Rejected",
      reason: "not enough scope",
    });
  });

  it("returns null and writes nothing when the application is gone", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    const prev = await setApplicationStage(db, {
      applicationId: "missing",
      to: "Interview",
    });
    expect(prev).toBeNull();
    expect(db.partnerApplication.update).not.toHaveBeenCalled();
    expect(db.partnerActivity.create).not.toHaveBeenCalled();
  });
});
