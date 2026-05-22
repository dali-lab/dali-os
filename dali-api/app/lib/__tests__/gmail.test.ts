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

describe("sendEmail — ICS calendar attachment", () => {
  const sampleIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:interview-abc@dali.dartmouth.edu",
    "DTSTART:20260522T141500Z",
    "DTEND:20260522T150000Z",
    "SUMMARY:DALI Interview",
    "ORGANIZER;CN=DALI Lab:mailto:applications@dali.dartmouth.edu",
    "ATTENDEE;CN=Kiran;RSVP=TRUE:mailto:kiran@example.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("places text/calendar inline in multipart/alternative AND as an application/ics attachment", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "kiran@example.com",
      subject: "DALI Lab Interview Invitation",
      html: "<p>See you there.</p>",
      ics: sampleIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);

    // Top-level multipart/mixed wrapping body alternatives + the attachment.
    expect(decoded).toMatch(/^Content-Type: multipart\/mixed; boundary="[^"]+"/m);

    // Body alternatives: text/plain → text/html → text/calendar (order matters
    // for clients that pick the "best" alternative, per RFC 2046 §5.1.4).
    expect(decoded).toContain("Content-Type: multipart/alternative;");
    expect(decoded).toContain("Content-Type: text/plain; charset=utf-8");
    expect(decoded).toContain("Content-Type: text/html; charset=utf-8");
    expect(decoded).toContain("<p>See you there.</p>");

    // text/calendar appears INLINE (no Content-Disposition: attachment on this
    // part) — that's what triggers Gmail's RSVP card.
    expect(decoded).toContain("Content-Type: text/calendar; charset=utf-8; method=REQUEST");

    // application/ics attachment for non-Gmail clients. Different MIME from
    // text/calendar so Gmail doesn't dedupe/drop one.
    expect(decoded).toContain('Content-Type: application/ics; name="invite.ics"');
    expect(decoded).toContain('Content-Disposition: attachment; filename="invite.ics"');

    // ICS round-trips through base64 (check both copies).
    const blocks = [...decoded.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n\r\n--/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const m of blocks) {
      const reconstructed = Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8");
      expect(reconstructed).toBe(sampleIcs);
    }
  });

  it("preserves METHOD:CANCEL from the ICS in the inline calendar Content-Type", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    const cancelIcs = sampleIcs.replace("METHOD:REQUEST", "METHOD:CANCEL");
    await sendEmail({
      refreshToken: "rt",
      to: "kiran@example.com",
      subject: "Interview Cancelled",
      html: "<p>Cancelled.</p>",
      ics: cancelIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);
    expect(decoded).toContain("Content-Type: text/calendar; charset=utf-8; method=CANCEL");
  });

  it("wraps base64 at 76 chars per line (RFC 2045)", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "kiran@example.com",
      subject: "Invite",
      html: "<p>x</p>",
      ics: sampleIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);
    const blocks = [...decoded.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n\r\n--/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const m of blocks) {
      for (const line of m[1].split("\r\n")) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    }
  });

  it("falls back to the simple text/html structure when no ICS is provided", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "kiran@example.com",
      subject: "No calendar",
      html: "<p>Plain.</p>",
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const decoded = decodeRaw(body.raw);
    expect(decoded).not.toContain("multipart/mixed");
    expect(decoded).not.toContain("text/calendar");
    expect(decoded).toMatch(/^Content-Type: text\/html; charset=utf-8$/m);
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
