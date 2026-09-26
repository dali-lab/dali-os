import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/roles", () => ({}));

import { MAIL_STATE_COOKIE, isMailConnectCallback } from "~/email/lib/mail-connect.server";

const callback = (state: string, cookie?: string) =>
  new Request(`http://localhost/integrations/calendar/google/callback?state=${state}&code=c`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

describe("isMailConnectCallback", () => {
  it("claims the shared callback only when the state matches the mail connect's cookie", () => {
    expect(isMailConnectCallback(callback("abc", `${MAIL_STATE_COOKIE}=abc.cGVyc29uYWw`))).toBe(true);
  });

  it("leaves calendar links alone", () => {
    expect(isMailConnectCallback(callback("abc"))).toBe(false);
    expect(isMailConnectCallback(callback("abc", `${MAIL_STATE_COOKIE}=other.cGVyc29uYWw`))).toBe(false);
    expect(isMailConnectCallback(callback("abc", "__dali_cal_oauth_state=abc"))).toBe(false);
  });
});
