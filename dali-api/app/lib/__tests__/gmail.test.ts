import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "~/lib/gmail";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const originalAppEnv = process.env.DALI_APP_ENV;

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  if (originalAppEnv === undefined) {
    delete process.env.DALI_APP_ENV;
  } else {
    process.env.DALI_APP_ENV = originalAppEnv;
  }
});

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function mockTokenAndSendOk() {
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "test-access-token" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "msg-1" }) });
}

describe("sendEmail — dev environment", () => {
  it("skips the Gmail call entirely", async () => {
    process.env.DALI_APP_ENV = "dev";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Hello",
      html: "<p>Body</p>",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, env: "dev" });
    infoSpy.mockRestore();
  });
});

describe("sendEmail — staging environment", () => {
  it("redirects to systems@dali.dartmouth.edu and adds a banner with the original recipient", async () => {
    process.env.DALI_APP_ENV = "staging";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Hello",
      html: "<p>Body</p>",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall[0]).toContain("/messages/send");
    const body = JSON.parse(sendCall[1].body as string);
    const decoded = decodeRaw(body.raw);
    expect(decoded).toContain("To: systems@dali.dartmouth.edu");
    expect(decoded).not.toContain("To: applicant@example.com");
    expect(decoded).toContain("[STAGING]");
    expect(decoded).toContain("applicant@example.com");
    expect(decoded).toContain("Subject: Hello");
  });
});

describe("sendEmail — prod environment", () => {
  it("sends to the original recipient with no banner", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Hello",
      html: "<p>Body</p>",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendCall = fetchMock.mock.calls[1];
    const body = JSON.parse(sendCall[1].body as string);
    const decoded = decodeRaw(body.raw);
    expect(decoded).toContain("To: applicant@example.com");
    expect(decoded).not.toContain("[STAGING]");
    expect(decoded).toContain("<p>Body</p>");
  });
});
