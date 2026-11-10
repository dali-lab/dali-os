import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: () => new Response("forbidden", { status: 403 }),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import {
  isOfferingManager,
  manageableOfferingIds,
  requireOfferingManager,
  requireEducationCore,
  redirectDartmouthToPortal,
  requireEnrollment,
} from "../access.server";

const m = prisma as any;
const req = new Request("http://localhost/education/off1/hub");

function authAs(type: "member" | "dartmouth", sub = "u1") {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub, type } } as never);
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(Response);
    return (e as Response).headers.get("Location")!;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  m.instructorAssignment.findFirst.mockResolvedValue(null);
  m.instructorAssignment.findMany.mockResolvedValue([]);
  m.educationApplication.findUnique.mockResolvedValue(null);
  authAs("member");
});

describe("isOfferingManager", () => {
  it("lets Core manage any offering without looking up assignments", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await isOfferingManager("u1", "off1")).toBe(true);
    expect(m.instructorAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("lets an instructor of that offering manage it", async () => {
    m.instructorAssignment.findFirst.mockResolvedValue({ id: "ia1" });
    expect(await isOfferingManager("u1", "off1")).toBe(true);
    expect(m.instructorAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", offeringId: "off1" },
      select: { id: true },
    });
  });

  it("refuses everyone else", async () => {
    expect(await isOfferingManager("u1", "off1")).toBe(false);
  });
});

describe("manageableOfferingIds", () => {
  it("is 'all' for Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await manageableOfferingIds("u1")).toBe("all");
    expect(m.instructorAssignment.findMany).not.toHaveBeenCalled();
  });

  it("is exactly the instructor's assigned offerings otherwise", async () => {
    m.instructorAssignment.findMany.mockResolvedValue([{ offeringId: "a" }, { offeringId: "b" }]);
    expect(await manageableOfferingIds("u1")).toEqual(["a", "b"]);
    expect(m.instructorAssignment.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { offeringId: true },
    });
  });

  it("is empty for someone with no assignments", async () => {
    expect(await manageableOfferingIds("u1")).toEqual([]);
  });
});

describe("requireOfferingManager / requireEducationCore", () => {
  it("passes an unauthenticated response straight through", async () => {
    const response = new Response("no", { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response } as never);
    expect(await requireOfferingManager(req, "off1")).toEqual({ ok: false, response });
    expect(await requireEducationCore(req)).toEqual({ ok: false, response });
  });

  it("403s a signed-in non-manager and returns auth for a manager", async () => {
    const denied = await requireOfferingManager(req, "off1");
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.response.status).toBe(403);

    m.instructorAssignment.findFirst.mockResolvedValue({ id: "ia1" });
    const allowed = await requireOfferingManager(req, "off1");
    expect(allowed.ok && allowed.auth.user.sub).toBe("u1");
  });

  it("requireEducationCore refuses an instructor who is not Core", async () => {
    m.instructorAssignment.findFirst.mockResolvedValue({ id: "ia1" });
    const res = await requireEducationCore(req);
    expect(!res.ok && res.response.status).toBe(403);
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await requireEducationCore(req)).ok).toBe(true);
  });
});

describe("redirectDartmouthToPortal", () => {
  it("sends Dartmouth-auth users to the education portal and leaves members alone", () => {
    const res = redirectDartmouthToPortal({ user: { type: "dartmouth" } } as never);
    expect(res?.headers.get("Location")).toBe("/portal/education");
    expect(redirectDartmouthToPortal({ user: { type: "member" } } as never)).toBeNull();
  });
});

describe("requireEnrollment", () => {
  const approved = { id: "app1", status: "Approved" };

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response() } as never);
    expect(await redirectOf(requireEnrollment(req, "off1", "member"))).toBe("/login");
  });

  it("admits an Approved applicant and returns the application id", async () => {
    m.educationApplication.findUnique.mockResolvedValue(approved);
    const out = await requireEnrollment(req, "off1", "member");
    expect(out).toMatchObject({ applicationId: "app1", isManager: false });
    expect(m.educationApplication.findUnique).toHaveBeenCalledWith({
      where: { applicantUserId_offeringId: { applicantUserId: "u1", offeringId: "off1" } },
      select: { id: true, status: true },
    });
  });

  it.each(["Pending", "Waitlisted", "Rejected", "Withdrawn"])(
    "bounces a %s applicant back to the offering page",
    async (status) => {
      m.educationApplication.findUnique.mockResolvedValue({ id: "app1", status });
      expect(await redirectOf(requireEnrollment(req, "off1", "member"))).toBe("/education/off1");
    },
  );

  it("bounces a user with no application, by surface", async () => {
    expect(await redirectOf(requireEnrollment(req, "off1", "member"))).toBe("/education/off1");
    authAs("dartmouth");
    expect(await redirectOf(requireEnrollment(req, "off1", "portal"))).toBe("/portal/education/off1");
  });

  it("lets a manager preview without an application (applicationId null)", async () => {
    m.instructorAssignment.findFirst.mockResolvedValue({ id: "ia1" });
    expect(await requireEnrollment(req, "off1", "member")).toMatchObject({
      applicationId: null,
      isManager: true,
    });
  });

  it("keeps a manager's own application id when they are also enrolled", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    m.educationApplication.findUnique.mockResolvedValue(approved);
    expect(await requireEnrollment(req, "off1", "member")).toMatchObject({
      applicationId: "app1",
      isManager: true,
    });
  });

  it("moves a non-manager Dartmouth user off the member shell to the portal hub", async () => {
    authAs("dartmouth");
    m.educationApplication.findUnique.mockResolvedValue(approved);
    expect(await redirectOf(requireEnrollment(req, "off1", "member"))).toBe("/portal/education/off1/hub");
  });

  it("lets a Dartmouth-auth manager stay on the member shell", async () => {
    authAs("dartmouth");
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await requireEnrollment(req, "off1", "member")).isManager).toBe(true);
  });

  it("moves a member who lands on the portal surface to the member hub, and never grants portal users manager", async () => {
    expect(await redirectOf(requireEnrollment(req, "off1", "portal"))).toBe("/education/off1/hub");
    authAs("dartmouth");
    vi.mocked(isCore).mockResolvedValue(true);
    m.educationApplication.findUnique.mockResolvedValue(approved);
    const out = await requireEnrollment(req, "off1", "portal");
    expect(out.isManager).toBe(false);
    expect(isCore).not.toHaveBeenCalled();
  });
});
