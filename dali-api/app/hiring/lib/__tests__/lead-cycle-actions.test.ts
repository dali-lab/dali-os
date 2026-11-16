import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/application-form.server", () => ({
  addDomainChallenge: vi.fn(),
  removeDomainChallenge: vi.fn(),
  createCycleApplicationForm: vi.fn(),
  createCycleContinuedInterestForm: vi.fn(),
}));
vi.mock("~/hiring/lib/extension-notice", () => ({ resendExtensionNotice: vi.fn() }));
vi.mock("~/hiring/lib/domain-added-notice", () => ({ sendDomainAddedNotice: vi.fn() }));
vi.mock("~/hiring/lib/domain-windows.server", () => ({ canEditDomainSetup: vi.fn(), setDomainReady: vi.fn() }));
vi.mock("~/hiring/lib/cycles", () => ({ invalidateActiveCycles: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { createCycleApplicationForm, createCycleContinuedInterestForm } from "~/hiring/lib/application-form.server";
import { resendExtensionNotice } from "~/hiring/lib/extension-notice";
import { sendDomainAddedNotice } from "~/hiring/lib/domain-added-notice";
import { canEditDomainSetup } from "~/hiring/lib/domain-windows.server";
import { invalidateActiveCycles } from "~/hiring/lib/cycles";
import { LEAD_CYCLE_ACTIONS, type LeadCycleActionContext } from "~/hiring/lib/lead-cycle-actions.server";

const CYCLE = "cycle-1";
const ACTOR = "lead-1";
const db = prisma as unknown as Record<string, any>;

function run(intent: string, form: Record<string, string> = {}, tab?: string) {
  const formData = new FormData();
  for (const [k, v] of Object.entries({ intent, ...form })) formData.set(k, v);
  const ctx: LeadCycleActionContext = {
    request: new Request(`http://localhost/hiring/lead/cycle/${CYCLE}${tab ? `?tab=${tab}` : ""}`, { method: "POST" }),
    formData,
    intent,
    cycleId: CYCLE,
    actorId: ACTOR,
    applicants: "Students",
  };
  return LEAD_CYCLE_ACTIONS[intent](ctx) as Promise<Response>;
}

const location = (res: Response) => res.headers.get("Location");

beforeEach(() => {
  vi.clearAllMocks();
  db.applicationCycle = { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn() };
  db.applicationCycleStatusUpdate = { findFirst: vi.fn().mockResolvedValue({ newStatus: "Draft" }) };
  db.applicationReview = { count: vi.fn().mockResolvedValue(0) };
  db.domainApplicationCycle = {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  };
});

describe("LEAD_CYCLE_ACTIONS", () => {
  it("has a handler for every intent the page posts, and nothing inherited", () => {
    expect(Object.keys(LEAD_CYCLE_ACTIONS)).toHaveLength(27);
    expect(Object.hasOwn(LEAD_CYCLE_ACTIONS, "constructor")).toBe(false);
  });

  describe("redirects", () => {
    it("keeps the active tab on the way back", async () => {
      db.applicationCycle.update.mockResolvedValue({});
      const res = await run("set-anonymize-review", { anonymizeReview: "on" }, "review");
      expect(location(res)).toBe(`/hiring/lead/cycle/${CYCLE}?tab=review`);
    });
  });

  describe("resend-extension-notice", () => {
    const outcome = (r: object) => vi.mocked(resendExtensionNotice).mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, alreadySent: 0, ...r } as any);
    it.each([
      [{ outcome: "no_extension" }, "extension-notice-no-extension"],
      [{ outcome: "preflight_skipped" }, "extension-notice-not-configured"],
      [{ outcome: "sent", attempted: 0 }, "extension-notice-noop"],
      [{ outcome: "sent", attempted: 2, alreadySent: 2 }, "extension-notice-all-sent"],
      [{ outcome: "sent", attempted: 3, succeeded: 2, failed: 1 }, "extension-notice-partial"],
      [{ outcome: "sent", attempted: 2, succeeded: 2 }, "extension-notice-sent"],
    ])("maps %o to %s", async (result, notice) => {
      outcome(result);
      const res = await run("resend-extension-notice");
      expect(new URL(location(res)!, "http://x").searchParams.get("notice")).toBe(notice);
      expect(resendExtensionNotice).toHaveBeenCalledWith(CYCLE);
    });
    it("reports the counts", async () => {
      outcome({ outcome: "sent", attempted: 3, succeeded: 2, failed: 1, alreadySent: 0 });
      const sp = new URL(location(await run("resend-extension-notice"))!, "http://x").searchParams;
      expect([sp.get("sent"), sp.get("failed"), sp.get("skipped")]).toEqual(["2", "1", "0"]);
    });
  });

  describe("set-general-rubric", () => {
    it("writes the picked version", async () => {
      await run("set-general-rubric", { rubricVersionId: "rv1" });
      expect(db.applicationCycle.update).toHaveBeenCalledWith({ where: { id: CYCLE }, data: { generalRubricVersionId: "rv1" } });
    });
    it("clears it when posted empty", async () => {
      await run("set-general-rubric", { rubricVersionId: "" });
      expect(db.applicationCycle.update).toHaveBeenCalledWith({ where: { id: CYCLE }, data: { generalRubricVersionId: null } });
    });
    it("writes nothing once reviews exist", async () => {
      db.applicationReview.count.mockResolvedValue(2);
      await run("set-general-rubric", { rubricVersionId: "rv1" });
      expect(db.applicationCycle.update).not.toHaveBeenCalled();
    });
  });

  describe("set-anonymize-review", () => {
    it("turns blind review on for 'on' and off when the field is absent", async () => {
      await run("set-anonymize-review", { anonymizeReview: "on" });
      expect(db.applicationCycle.update).toHaveBeenLastCalledWith({ where: { id: CYCLE }, data: { anonymizeReview: true } });
      await run("set-anonymize-review");
      expect(db.applicationCycle.update).toHaveBeenLastCalledWith({ where: { id: CYCLE }, data: { anonymizeReview: false } });
    });
  });

  describe("application forms", () => {
    it("create-application-form binds a new form for the actor", async () => {
      await run("create-application-form");
      expect(createCycleApplicationForm).toHaveBeenCalledWith(CYCLE, ACTOR);
    });
    it("set-application-form stores the picked form or null", async () => {
      await run("set-application-form", { formId: "f1" });
      expect(db.applicationCycle.update).toHaveBeenLastCalledWith({ where: { id: CYCLE }, data: { applicationFormId: "f1" } });
      await run("set-application-form", { formId: "" });
      expect(db.applicationCycle.update).toHaveBeenLastCalledWith({ where: { id: CYCLE }, data: { applicationFormId: null } });
    });
    it("create-continued-interest-form binds a new form for the actor", async () => {
      await run("create-continued-interest-form");
      expect(createCycleContinuedInterestForm).toHaveBeenCalledWith(CYCLE, ACTOR);
    });
    it("set-continued-interest-form stores the picked form or null", async () => {
      await run("set-continued-interest-form", { formId: "f2" });
      expect(db.applicationCycle.update).toHaveBeenLastCalledWith({ where: { id: CYCLE }, data: { continuedInterestFormId: "f2" } });
      await run("set-continued-interest-form", { formId: "" });
      expect(db.applicationCycle.update).toHaveBeenLastCalledWith({ where: { id: CYCLE }, data: { continuedInterestFormId: null } });
    });
  });

  describe("add-domain / remove-domain", () => {
    it("adds a domain while the cycle is Draft or Open", async () => {
      for (const s of ["Draft", "Open"]) {
        db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: s });
        await run("add-domain", { domainId: "d1" });
      }
      expect(db.domainApplicationCycle.create).toHaveBeenCalledTimes(2);
      expect(db.domainApplicationCycle.create).toHaveBeenCalledWith({ data: { domainId: "d1", applicationCycleId: CYCLE } });
    });
    it("returns 409 and writes nothing when adding after review started", async () => {
      db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "UnderReview" });
      const res = await run("add-domain", { domainId: "d1" });
      expect(res.status).toBe(409);
      expect(db.domainApplicationCycle.create).not.toHaveBeenCalled();
    });
    it("removes a domain only when its setup is still editable", async () => {
      vi.mocked(canEditDomainSetup).mockResolvedValue(true);
      await run("remove-domain", { domainId: "d1" });
      expect(db.domainApplicationCycle.delete).toHaveBeenCalledWith({
        where: { domainId_applicationCycleId: { domainId: "d1", applicationCycleId: CYCLE } },
      });
      vi.mocked(canEditDomainSetup).mockResolvedValue(false);
      const res = await run("remove-domain", { domainId: "d2" });
      expect(res.status).toBe(409);
      expect(db.domainApplicationCycle.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("set-domain-close-date", () => {
    it("requires a domain", async () => {
      expect((await run("set-domain-close-date", {})).status).toBe(400);
    });
    it("returns 409 once the cycle is past Open", async () => {
      db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "UnderReview" });
      expect((await run("set-domain-close-date", { domainId: "d1", closeDate: "2099-01-01" })).status).toBe(409);
      expect(db.domainApplicationCycle.update).not.toHaveBeenCalled();
    });
    it("rejects a date that has passed", async () => {
      const res = await run("set-domain-close-date", { domainId: "d1", closeDate: "2001-01-01" });
      expect(res.status).toBe(400);
      expect(db.domainApplicationCycle.update).not.toHaveBeenCalled();
    });
    it("stores a future date and clears the active-cycle cache", async () => {
      const res = await run("set-domain-close-date", { domainId: "d1", closeDate: "2099-01-01" });
      expect(res).toEqual({ ok: true });
      expect(db.domainApplicationCycle.update.mock.calls[0][0].data.closeDate).toBeInstanceOf(Date);
      expect(invalidateActiveCycles).toHaveBeenCalled();
    });
    it("clears the date when posted empty", async () => {
      await run("set-domain-close-date", { domainId: "d1", closeDate: "" });
      expect(db.domainApplicationCycle.update.mock.calls[0][0].data).toEqual({ closeDate: null });
    });
  });

  describe("notify-domain-added", () => {
    const sent = (r: object) => vi.mocked(sendDomainAddedNotice).mockResolvedValue({ sent: 0, alreadySent: 0, skipped: 0, ...r } as any);
    const ready = () => {
      db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });
      db.domainApplicationCycle.findUnique.mockResolvedValue({ isReady: true });
    };
    it("does nothing without confirm=true", async () => {
      await run("notify-domain-added", { domainId: "d1" });
      expect(sendDomainAddedNotice).not.toHaveBeenCalled();
    });
    it("returns 409 when the cycle is not Open", async () => {
      db.domainApplicationCycle.findUnique.mockResolvedValue({ isReady: true });
      const res = await run("notify-domain-added", { domainId: "d1", confirm: "true" });
      expect(res.status).toBe(409);
      expect(sendDomainAddedNotice).not.toHaveBeenCalled();
    });
    it("returns 409 when the domain is not ready", async () => {
      db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });
      db.domainApplicationCycle.findUnique.mockResolvedValue({ isReady: false });
      expect((await run("notify-domain-added", { domainId: "d1", confirm: "true" })).status).toBe(409);
    });
    it.each([
      [{}, "domain-added-notice-noop"],
      [{ alreadySent: 2 }, "domain-added-notice-all-sent"],
      [{ skipped: 2 }, "domain-added-notice-not-configured"],
      [{ sent: 1, skipped: 1 }, "domain-added-notice-partial"],
      [{ sent: 2 }, "domain-added-notice-sent"],
    ])("maps %o to %s", async (result, notice) => {
      ready();
      sent(result);
      const res = await run("notify-domain-added", { domainId: "d1", confirm: "true" });
      expect(new URL(location(res)!, "http://x").searchParams.get("notice")).toBe(notice);
      expect(sendDomainAddedNotice).toHaveBeenCalledWith(CYCLE, "d1", ACTOR);
    });
  });
});
