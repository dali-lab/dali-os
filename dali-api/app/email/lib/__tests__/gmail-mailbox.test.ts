import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/google-calendar", () => ({
  parseStoredTokens: () => {
    throw new Error("Unsupported state or unable to authenticate data");
  },
  buildEncryptedTokens: () => "sealed",
}));

import { decodeEntities, getMailboxToken, getThread, MailboxError, sendMessage } from "~/email/lib/gmail-mailbox.server";

afterEach(() => vi.restoreAllMocks());

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function mockFetch(json: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("getThread", () => {
  it("picks the HTML and text bodies out of nested parts and lists attachments", async () => {
    mockFetch({
      messages: [
        {
          id: "m1",
          internalDate: "1758800000000",
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: "Ada <ada@x.com>" },
              { name: "Subject", value: "Hello" },
              { name: "Message-ID", value: "<abc@x.com>" },
            ],
            parts: [
              {
                mimeType: "multipart/alternative",
                parts: [
                  { mimeType: "text/plain", body: { data: b64("plain body") } },
                  { mimeType: "text/html", body: { data: b64("<p>html body</p>") } },
                ],
              },
              { mimeType: "application/pdf", filename: "deck.pdf", body: { attachmentId: "x" } },
            ],
          },
        },
      ],
    });
    const [m] = await getThread("token", "t1");
    expect(m).toMatchObject({
      from: "Ada <ada@x.com>",
      subject: "Hello",
      messageId: "<abc@x.com>",
      text: "plain body",
      html: "<p>html body</p>",
      attachments: [{ filename: "deck.pdf", mimeType: "application/pdf", size: 0, attachmentId: "x" }],
    });
  });

  it("skips inline embedded images but keeps real attachments", async () => {
    mockFetch({
      messages: [
        {
          id: "m1",
          internalDate: "1758800000000",
          payload: {
            mimeType: "multipart/mixed",
            headers: [{ name: "From", value: "Ada <ada@x.com>" }],
            parts: [
              { mimeType: "text/plain", body: { data: b64("hi") } },
              {
                mimeType: "image/png",
                filename: "logo.png",
                headers: [
                  { name: "Content-Disposition", value: "inline" },
                  { name: "Content-ID", value: "<logo>" },
                ],
                body: { attachmentId: "inline1", size: 10 },
              },
              { mimeType: "application/pdf", filename: "deck.pdf", body: { attachmentId: "a2", size: 2048 } },
            ],
          },
        },
      ],
    });
    const [m] = await getThread("token", "t1");
    expect(m.attachments).toEqual([
      { filename: "deck.pdf", mimeType: "application/pdf", size: 2048, attachmentId: "a2" },
    ]);
  });
});

describe("getMailboxToken", () => {
  it("turns an undecryptable token into a MailboxError, not a raw crypto throw", async () => {
    await expect(getMailboxToken({ id: "a1", oauthTokens: "garbage" })).rejects.toBeInstanceOf(MailboxError);
  });

  it("still rejects a not-connected account", async () => {
    await expect(getMailboxToken({ id: "a1", oauthTokens: null })).rejects.toBeInstanceOf(MailboxError);
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric HTML entities in Gmail snippets", () => {
    expect(decodeEntities("don&#39;t &amp; won&#39;t")).toBe("don't & won't");
    expect(decodeEntities("a &lt;b&gt; &quot;c&quot; &#x27;d&#x27;")).toBe('a <b> "c" \'d\'');
    expect(decodeEntities("no&nbsp;break")).toBe("no break");
    // Leaves unknown/malformed entities untouched.
    expect(decodeEntities("100% &bogus; safe")).toBe("100% &bogus; safe");
  });
});

describe("sendMessage", () => {
  it("threads replies and strips header injection", async () => {
    const fetchSpy = mockFetch({ id: "sent" });
    await sendMessage("token", {
      from: "me@dali.dartmouth.edu",
      to: "ada@x.com\r\nBcc: evil@x.com",
      cc: "",
      bcc: "",
      subject: "Re: Café",
      body: "Thanks!",
      threadId: "t1",
      inReplyTo: "<abc@x.com>",
      references: "<root@x.com>",
    });
    const sent = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as { raw: string; threadId: string };
    const raw = Buffer.from(sent.raw, "base64url").toString("utf8");
    expect(sent.threadId).toBe("t1");
    expect(raw).toContain("To: ada@x.comBcc: evil@x.com\r\n");
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).not.toMatch(/^Cc:/m);
    expect(raw).toContain("In-Reply-To: <abc@x.com>");
    expect(raw).toContain("References: <root@x.com> <abc@x.com>");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Re: Café").toString("base64")}?=`);
    expect(raw.split("\r\n\r\n")[1]).toBe(Buffer.from("Thanks!").toString("base64"));
  });

  it("adds a Bcc header when there are Bcc recipients", async () => {
    const fetchSpy = mockFetch({ id: "sent" });
    await sendMessage("token", { from: "me@x.com", to: "ada@x.com", cc: "", bcc: "grace@x.com", subject: "Hi", body: "" });
    const sent = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as { raw: string };
    expect(Buffer.from(sent.raw, "base64url").toString("utf8")).toMatch(/^Bcc: grace@x\.com\r$/m);
  });

  it("builds a multipart/mixed message when there are attachments", async () => {
    const fetchSpy = mockFetch({ id: "sent" });
    await sendMessage("token", {
      from: "me@x.com",
      to: "ada@x.com",
      cc: "",
      bcc: "",
      subject: "Deck",
      body: "See attached",
      attachments: [{ filename: 'q3 "report".pdf', contentType: "application/pdf", bytes: Buffer.from("PDFDATA") }],
    });
    const sent = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as { raw: string };
    const raw = Buffer.from(sent.raw, "base64url").toString("utf8");
    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    expect(raw).toContain("Content-Type: multipart/mixed;");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).toContain(Buffer.from("See attached").toString("base64"));
    // Quotes stripped from the filename so they can't break the header.
    expect(raw).toContain('Content-Disposition: attachment; filename="q3 report.pdf"');
    expect(raw).toContain(Buffer.from("PDFDATA").toString("base64"));
    expect(raw.trimEnd()).toMatch(new RegExp(`--${boundary}--$`));
  });
});
