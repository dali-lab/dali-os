import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { featureFlag: { findMany: vi.fn(async () => []) } },
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));
vi.mock("~/lib/app-env", () => ({
  getFrontendUrl: vi.fn(() => "https://os.dali.dartmouth.edu"),
  getAppEnv: vi.fn(() => "prod"),
  PARTNERS_FROM_EMAIL: "partners@dali.dartmouth.edu",
}));
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: vi.fn(async () => true),
}));

import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { handleWebsiteMeetingRequest } from "../public-meeting-request.server";

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const mockFlag = isFeatureEnabledForEveryone as unknown as ReturnType<typeof vi.fn>;

const SECRET = "test-showcase-secret";
const body = {
  name: "Jordan Lee",
  email: "jordan@example.com",
  org: "Geisel",
  project: "Smart Microscope",
  need: "Light, steady upkeep (about 2 hrs/week)",
  plan: "Maintenance",
  payer: "Dartmouth department",
  notes: "Hoping to start in Winter.",
};

function req(payload: unknown, opts: { secret?: string | null; method?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  if (secret) headers["x-showcase-secret"] = secret;
  return new Request("http://localhost/api/public/partner-meeting-requests", {
    method: opts.method ?? "POST",
    headers,
    body: (opts.method ?? "POST") === "POST" ? (opts.raw ?? JSON.stringify(payload)) : undefined,
  });
}

let savedSecret: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mockFlag.mockResolvedValue(true);
  savedSecret = process.env.SHOWCASE_API_SECRET;
  process.env.SHOWCASE_API_SECRET = SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.SHOWCASE_API_SECRET;
  else process.env.SHOWCASE_API_SECRET = savedSecret;
});

describe("POST /api/public/partner-meeting-requests", () => {
  it("emails partners@ from the Partners sender with the request details", async () => {
    const res = await handleWebsiteMeetingRequest(req(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const mail = mockEnqueue.mock.calls[0][0];
    expect(mail).toMatchObject({
      channel: "email",
      purpose: "Partners",
      target: "partners@dali.dartmouth.edu",
      dedupKey: null,
      eventType: "partner.website_meeting_request",
    });
    expect(mail.subject).toBe("Meeting request: Jordan Lee (Geisel)");
    for (const v of ["jordan@example.com", "Smart Microscope", "Maintenance", "Dartmouth department", "Hoping to start in Winter."]) {
      expect(mail.bodyHtml).toContain(v);
      expect(mail.bodyText).toContain(v);
    }
    expect(mail.bodyHtml).toContain("mailto:jordan%40example.com");
    expect(drainNow).toHaveBeenCalledWith(["om-1"]);
  });

  it("escapes what the partner typed", async () => {
    await handleWebsiteMeetingRequest(
      req({ ...body, name: "<b>Eve</b>", org: "A & B", notes: "<script>x</script>" }),
    );
    const mail = mockEnqueue.mock.calls[0][0];
    expect(mail.bodyHtml).not.toContain("<b>Eve</b>");
    expect(mail.bodyHtml).not.toContain("<script>");
    expect(mail.bodyHtml).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(mail.bodyHtml).toContain("A &amp; B");
  });

  it("leaves out the notes block when there are no notes", async () => {
    const { notes: _notes, ...noNotes } = body;
    await handleWebsiteMeetingRequest(req(noNotes));
    expect(mockEnqueue.mock.calls[0][0].bodyHtml).not.toContain("white-space:pre-wrap");
  });

  it("rejects a missing or wrong secret without sending", async () => {
    expect((await handleWebsiteMeetingRequest(req(body, { secret: null }))).status).toBe(401);
    expect((await handleWebsiteMeetingRequest(req(body, { secret: "nope" }))).status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("fails closed when the secret isn't configured", async () => {
    delete process.env.SHOWCASE_API_SECRET;
    expect((await handleWebsiteMeetingRequest(req(body))).status).toBe(503);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 404 and sends nothing when the flag is off", async () => {
    mockFlag.mockResolvedValue(false);
    expect((await handleWebsiteMeetingRequest(req(body))).status).toBe(404);
    expect(mockFlag).toHaveBeenCalledWith("website-meeting-requests", expect.any(Request));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects invalid bodies", async () => {
    for (const bad of [
      { ...body, email: "not-an-email" },
      { ...body, name: "" },
      { ...body, project: "x".repeat(201) },
      { ...body, notes: "x".repeat(4001) },
      { name: "Only a name" },
    ]) {
      expect((await handleWebsiteMeetingRequest(req(bad))).status).toBe(400);
    }
    expect((await handleWebsiteMeetingRequest(req(null, { raw: "{not json" }))).status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    expect((await handleWebsiteMeetingRequest(req(null, { method: "GET" }))).status).toBe(405);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
