import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
vi.mock("~/lib/db", () => ({ prisma: { user: { update: (...a: unknown[]) => update(...a) } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { action } from "~/routes/api.desktop-hint.dismiss";

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;

function post() {
  const request = new Request("http://localhost/api/desktop-hint/dismiss", { method: "POST" });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("desktop hint dismiss action", () => {
  it("stamps the signed-in user only", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "ada-id" } });
    const res = await post();
    expect(await res.json()).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "ada-id" });
    expect(arg.data.desktopHintDismissedAt).toBeInstanceOf(Date);
  });

  it("rejects unauthenticated requests without writing", async () => {
    const response = new Response("nope", { status: 401 });
    mockAuth.mockResolvedValue({ ok: false, response });
    expect(await post()).toBe(response);
    expect(update).not.toHaveBeenCalled();
  });
});
