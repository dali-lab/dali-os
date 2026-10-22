import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodeHeader, makeRawEmail, sendEmail } from "~/lib/gmail";

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

const BASE64_PART = /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n\r\n--/g;
const ICS_PART =
  /Content-Type: (?:text\/calendar|application\/ics)[^\r\n]*\r\n(?:[^\r\n]+\r\n)*?Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n\r\n--/g;

function fromBase64(block: string): string {
  return Buffer.from(block.replace(/\r\n/g, ""), "base64").toString("utf8");
}

// The wire message with every base64 part decoded in place, for content checks.
function decodeRaw(raw: string): string {
  const wire = Buffer.from(raw, "base64url").toString("utf8");
  return wire.replace(BASE64_PART, (_m, b64: string) => `Content-Transfer-Encoding: base64\r\n\r\n${fromBase64(b64)}\r\n\r\n--`);
}

function wireRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function icsParts(raw: string): string[] {
  return [...wireRaw(raw).matchAll(ICS_PART)].map((m) => fromBase64(m[1]));
}

function partBody(raw: string, contentType: string): string {
  const wire = wireRaw(raw);
  const start = wire.indexOf(`Content-Type: ${contentType}`);
  expect(start).toBeGreaterThan(-1);
  const afterHeaders = wire.indexOf("\r\n\r\n", start) + 4;
  return fromBase64(wire.slice(afterHeaders, wire.indexOf("\r\n--", afterHeaders)));
}

function decodeEncodedWords(header: string): string {
  return Buffer.concat(
    header.split("\r\n ").map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
      if (!m) throw new Error(`not an encoded word: ${w}`);
      return Buffer.from(m[1], "base64");
    }),
  ).toString("utf8");
}

function headerValue(message: string, name: string): string {
  const m = message.match(new RegExp(`^${name}: (.*(?:\\r\\n .*)*)`, "m"));
  if (!m) throw new Error(`missing header ${name}`);
  return m[1];
}

const isAscii = (s: string) => /^[\x20-\x7e\r\n]*$/.test(s);

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
    // Subject also gets the [STAGING] tag so the inbox row is visually distinct.
    expect(decoded).toContain("Subject: [STAGING] Hello");
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

  it("sends against the me mailbox and defaults From to applications@", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Hello",
      html: "<p>Body</p>",
    });

    // `me` = the token's own account, so any sender's token can send.
    expect(fetchMock.mock.calls[1][0]).toContain("/users/me/messages/send");
    const decoded = decodeRaw(JSON.parse(fetchMock.mock.calls[1][1].body as string).raw);
    expect(decoded).toContain("From: DALI Lab <applications@dali.dartmouth.edu>");
  });

  it("stamps From with an explicit sender identity so a non-applications token can send", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      from: "dalios@dali.dartmouth.edu",
      to: "member@dali.dartmouth.edu",
      subject: "Announcement",
      html: "<p>Body</p>",
    });

    const decoded = decodeRaw(JSON.parse(fetchMock.mock.calls[1][1].body as string).raw);
    expect(decoded).toContain("From: DALI Lab <dalios@dali.dartmouth.edu>");
    expect(decoded).not.toContain("applications@dali.dartmouth.edu");
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
    const parts = icsParts(body.raw);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(p).toBe(sampleIcs);
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
    const blocks = [...wireRaw(body.raw).matchAll(BASE64_PART)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const m of blocks) {
      for (const line of m[1].split("\r\n")) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    }
  });

  it("injects systems@ as an extra ATTENDEE in staging so Gmail renders the RSVP card", async () => {
    process.env.DALI_APP_ENV = "staging";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Invite",
      html: "<p>hi</p>",
      ics: sampleIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const reconstructed = icsParts(body.raw)[0]!;
    expect(reconstructed).toContain("mailto:kiran@example.com");
    expect(reconstructed).toContain("mailto:systems@dali.dartmouth.edu");
    // Inserted before END:VEVENT, not after — the redirect attendee must be
    // inside the VEVENT block to be recognized.
    expect(reconstructed).toMatch(/ATTENDEE[^\r\n]*systems@dali\.dartmouth\.edu\r\nEND:VEVENT/);
  });

  it("prefixes the ICS SUMMARY with [STAGING] so the calendar event title is tagged", async () => {
    process.env.DALI_APP_ENV = "staging";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Invite",
      html: "<p>hi</p>",
      ics: sampleIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const reconstructed = icsParts(body.raw)[0]!;
    expect(reconstructed).toContain("SUMMARY:[STAGING] DALI Interview");
    expect(reconstructed).not.toMatch(/^SUMMARY:DALI Interview/m);
  });

  it("does NOT prefix the ICS SUMMARY in prod", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Invite",
      html: "<p>hi</p>",
      ics: sampleIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const reconstructed = icsParts(body.raw)[0]!;
    expect(reconstructed).not.toContain("[STAGING]");
    expect(reconstructed).toContain("SUMMARY:DALI Interview");
  });

  it("does NOT inject the staging attendee in prod", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "applicant@example.com",
      subject: "Invite",
      html: "<p>hi</p>",
      ics: sampleIcs,
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const reconstructed = icsParts(body.raw)[0]!;
    expect(reconstructed).not.toContain("systems@dali.dartmouth.edu");
  });

  it("still carries a text/plain alternative when there is no ICS or attachment", async () => {
    // This used to emit a bare text/html part, which was the shape of most
    // sends. HTML-only mail trips SpamAssassin's MIME_HTML_ONLY and gives
    // text-only clients and screen readers nothing to fall back to.
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
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).toContain("Content-Type: text/plain; charset=utf-8");
    expect(decoded).toContain("Content-Type: text/html; charset=utf-8");
    // Derived from the HTML when the caller doesn't supply one.
    expect(decoded).toContain("Plain.");
    expect(decoded).not.toContain("text/calendar");
  });

  it("prefers a caller-supplied text part over deriving one from the HTML", async () => {
    process.env.DALI_APP_ENV = "prod";
    mockTokenAndSendOk();

    await sendEmail({
      refreshToken: "rt",
      to: "kiran@example.com",
      subject: "Code",
      html: "<p>Your code is <strong>123456</strong>.</p>",
      text: "Your code is 123456.",
    });

    const decoded = decodeRaw(
      JSON.parse(fetchMock.mock.calls[1][1].body as string).raw,
    );
    expect(decoded).toContain("Your code is 123456.");
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

describe("encodeHeader", () => {
  it("leaves printable ASCII untouched", () => {
    expect(encodeHeader("You're in: CS0 Session 6")).toBe("You're in: CS0 Session 6");
  });

  it("strips CR and LF before encoding", () => {
    expect(encodeHeader("a\r\nBcc: x@y.z")).toBe("aBcc: x@y.z");
  });

  it("encodes emoji as RFC 2047 words that round-trip", () => {
    const subject = "🎉 Congratulations!! You're in for DALI Miniseries: Purpose Lab 🎉";
    const encoded = encodeHeader(subject);
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(isAscii(encoded)).toBe(true);
    expect(decodeEncodedWords(encoded)).toBe(subject);
  });

  it("encodes non-emoji non-ASCII such as the middle dot", () => {
    const subject = "Upcoming: Session 6 · Friday, Oct 16";
    expect(decodeEncodedWords(encodeHeader(subject))).toBe(subject);
  });

  it("keeps every encoded word at or under 75 characters", () => {
    const subject = "🎉".repeat(40) + " é".repeat(60);
    const words = encodeHeader(subject).split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(decodeEncodedWords(encodeHeader(subject))).toBe(subject);
  });

  it("never splits a multi-byte character across words", () => {
    const words = encodeHeader("x".repeat(44) + "🎉").split("\r\n ");
    for (const w of words) {
      expect(Buffer.from(w.slice(10, -2), "base64").toString("utf8")).not.toContain("�");
    }
  });
});

describe("makeRawEmail — encoding", () => {
  const subject = "🎉 You’re in for Purpose Lab";
  const html = `<!DOCTYPE html><html><body><p>${"Café 🎉 ".repeat(400)}</p></body></html>`;

  it("produces a fully ASCII message", () => {
    expect(isAscii(wireRaw(makeRawEmail("a@b.edu", subject, html, "from@dali.edu")))).toBe(true);
  });

  it("keeps every line within the 998-character limit", () => {
    for (const line of wireRaw(makeRawEmail("a@b.edu", subject, html, "from@dali.edu")).split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });

  it("encodes the subject header so it decodes to the original", () => {
    const wire = wireRaw(makeRawEmail("a@b.edu", subject, html, "from@dali.edu"));
    expect(decodeEncodedWords(headerValue(wire, "Subject"))).toBe(subject);
  });

  it("base64-encodes the html and text parts and they round-trip", () => {
    const raw = makeRawEmail("a@b.edu", subject, html, "from@dali.edu", undefined, undefined, "Hi 🎉 there");
    const wire = wireRaw(raw);
    expect(wire).toMatch(/Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
    expect(wire).toMatch(/Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
    expect(partBody(raw, "text/html")).toBe(html);
    expect(partBody(raw, "text/plain")).toBe("Hi 🎉 there");
  });

  it("keeps ASCII attachment filenames as quoted params", () => {
    const wire = wireRaw(
      makeRawEmail("a@b.edu", "s", "<p>x</p>", "f@d.edu", undefined, [
        { filename: "receipt.pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
      ]),
    );
    expect(wire).toContain('Content-Type: application/pdf; name="receipt.pdf"');
    expect(wire).toContain('Content-Disposition: attachment; filename="receipt.pdf"');
  });

  it("encodes non-ASCII attachment filenames per RFC 2231", () => {
    const wire = wireRaw(
      makeRawEmail("a@b.edu", "s", "<p>x</p>", "f@d.edu", undefined, [
        { filename: "Résumé (final).pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
      ]),
    );
    expect(isAscii(wire)).toBe(true);
    expect(decodeURIComponent(wire.match(/filename\*=UTF-8''(\S+)/)![1])).toBe("Résumé (final).pdf");
    const name = wire.match(/name="(=\?UTF-8\?B\?[^"]+)"/)![1];
    expect(decodeEncodedWords(name.replace(/\?==\?UTF-8\?B\?/g, "?=\r\n =?UTF-8?B?"))).toBe("Résumé (final).pdf");
  });

  it("replaces quotes in attachment filenames so the param cannot break out", () => {
    const wire = wireRaw(
      makeRawEmail("a@b.edu", "s", "<p>x</p>", "f@d.edu", undefined, [
        { filename: 'a"b.pdf', mimeType: "application/pdf", content: Buffer.from("pdf") },
      ]),
    );
    expect(wire).toContain('filename="a_b.pdf"');
  });
});
