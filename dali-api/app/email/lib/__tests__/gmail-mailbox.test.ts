import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));

import { getThread, sendMessage } from "~/email/lib/gmail-mailbox.server";

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
      attachments: ["deck.pdf"],
    });
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
});
