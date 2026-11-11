import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { user: { findMany: vi.fn(async () => []) } } }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  redirectPartnerToPortal: vi.fn(async () => null),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/read-only-roles.server", () => ({ readOnlyRoles: vi.fn(async () => ({ isAlumni: true })) }));
vi.mock("~/lib/shell-user.server", () => ({ loadShellUser: vi.fn(async () => ({ timeZone: "America/New_York", birthday: null })) }));
vi.mock("~/lib/tasks", () => ({ listMyProjectTasks: vi.fn(async () => []), listOpenTasks: vi.fn(async () => []) }));
vi.mock("~/lib/roles", () => ({ currentTermStrict: vi.fn(async () => null) }));
vi.mock("~/components/CommandPalette", () => ({ resultIcon: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { loader } from "../home";

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("home loader", () => {
  it("gives alumni the home page instead of sending them to Community", async () => {
    const res = await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    expect(res).not.toBeInstanceOf(Response);
    expect(res).toMatchObject({ tasks: [], birthdays: [], week: null });
  });
});
