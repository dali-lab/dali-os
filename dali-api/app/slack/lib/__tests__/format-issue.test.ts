import { describe, it, expect } from "vitest";
import { formatIssue } from "../format-issue";

describe("formatIssue", () => {
  it("derives the title from the first line of the parent message, stripped of mentions", () => {
    const { title } = formatIssue({
      thread: [
        {
          ts: "1700000000.000100",
          user: "U001",
          text: "<@UBOT> file-this Login button is broken on mobile\nmore detail here",
          files: [],
        },
      ],
      permalink: "https://slack.example/archives/C/p1700000000000100",
      requestedBySlackUserId: "U001",
    });
    expect(title).toBe("[Slack] file-this Login button is broken on mobile");
  });

  it("truncates very long titles", () => {
    const long = "x".repeat(200);
    const { title } = formatIssue({
      thread: [{ ts: "1700000000.0", user: "U001", text: long, files: [] }],
      permalink: null,
      requestedBySlackUserId: "U001",
    });
    expect(title.startsWith("[Slack] ")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("includes every message in the body as a blockquote", () => {
    const { body } = formatIssue({
      thread: [
        { ts: "1700000000.0", user: "U001", text: "Bug: signup form rejects valid emails", files: [] },
        { ts: "1700000060.0", user: "U002", text: "Repro: try j+test@dali.dartmouth.edu", files: [] },
      ],
      permalink: "https://slack.example/p1700000000000",
      requestedBySlackUserId: "U001",
    });
    expect(body).toContain("Original thread: https://slack.example/p1700000000000");
    expect(body).toContain("> Bug: signup form rejects valid emails");
    expect(body).toContain("> Repro: try j+test@dali.dartmouth.edu");
    expect(body).toContain("<@U001>");
    expect(body).toContain("<@U002>");
  });

  it("notes attachments by name and points readers back to the Slack thread", () => {
    const { body } = formatIssue({
      thread: [
        {
          ts: "1700000000.0",
          user: "U001",
          text: "Screenshot below",
          files: [
            { id: "F1", name: "shot.png", mimetype: "image/png", urlPrivate: "x" },
            { id: "F2", name: "log.txt", mimetype: "text/plain", urlPrivate: "y" },
          ],
        },
      ],
      permalink: null,
      requestedBySlackUserId: "U001",
    });
    expect(body).toContain("_Attachment: shot.png — see Slack thread for content._");
    expect(body).toContain("_Attachment: log.txt — see Slack thread for content._");
  });

  it("handles empty threads gracefully", () => {
    const out = formatIssue({
      thread: [],
      permalink: null,
      requestedBySlackUserId: "U001",
    });
    expect(out.title).toContain("(empty thread)");
    expect(out.body).toContain("empty Slack thread");
  });
});
