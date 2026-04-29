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

describe("sendEmail — header injection defense", () => {
  function headerLines(decoded: string): string[] {
    const headerBlock = decoded.split("\r\n\r\n", 1)[0];
    return headerBlock.split("\r\n");
  }

  it("strips CRLF from the To header so injected Bcc is not emitted as a header", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com\r\nBcc: attacker@evil.com",
      subject: "Hello",
      html: "<p>Body</p>",
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);
    const headers = headerLines(decoded);
    expect(headers.some((l) => /^Bcc:/i.test(l))).toBe(false);
    const toLine = headers.find((l) => l.startsWith("To:"));
    expect(toLine).toBe("To: applicant@example.comBcc: attacker@evil.com");
  });

  it("strips CRLF from the Subject header so injected headers are not emitted as headers", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Hello\r\nReply-To: attacker@evil.com",
      html: "<p>Body</p>",
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);
    const headers = headerLines(decoded);
    expect(headers.some((l) => /^Reply-To:/i.test(l))).toBe(false);
    const subjectLine = headers.find((l) => l.startsWith("Subject:"));
    expect(subjectLine).toBe("Subject: HelloReply-To: attacker@evil.com");
  });

  it("strips bare LF from headers", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com\nBcc: attacker@evil.com",
      subject: "Hello\nX-Bad: 1",
      html: "<p>Body</p>",
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);
    const headers = headerLines(decoded);
    expect(headers.some((l) => /^Bcc:/i.test(l))).toBe(false);
    expect(headers.some((l) => /^X-Bad:/i.test(l))).toBe(false);
  });
});
