import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/roles", () => ({}));

import {
  htmlToText,
  parseSearchResponse,
  threadToContext,
  writingUserPrompt,
  MAX_CONTEXT_CHARS,
} from "~/email/lib/ai-prompts";
import { recipientDirectory, senderAddress, senderName, shortDate } from "~/email/lib/format";
import { addressSuggestions } from "~/email/components/AddressInput";
import { wordDiff } from "~/email/lib/word-diff";
import { parseConnectTarget, serializeConnectTarget } from "~/email/lib/access.server";

describe("parseSearchResponse", () => {
  it("reads the query and keeps only inboxes the user can see", () => {
    const raw = 'Sure:\n{"query": "from:ada newer_than:7d", "accounts": ["a1", "zzz"]}';
    expect(parseSearchResponse(raw, ["a1", "a2"])).toEqual({
      query: "from:ada newer_than:7d",
      accounts: ["a1"],
    });
  });

  it("returns null for anything that isn't the expected JSON", () => {
    expect(parseSearchResponse("from:ada", ["a1"])).toBeNull();
    expect(parseSearchResponse('{"accounts": []}', ["a1"])).toBeNull();
    expect(parseSearchResponse("{not json}", ["a1"])).toBeNull();
  });
});

describe("writingUserPrompt", () => {
  it("puts the thread before the instruction for a reply draft", () => {
    const prompt = writingUserPrompt({ task: "draft", text: "", instruction: "Say yes", thread: "From: Ada" });
    expect(prompt.indexOf("From: Ada")).toBeLessThan(prompt.indexOf("Say yes"));
    expect(prompt).not.toContain("Notes or partial draft");
  });

  it("sends the draft for rewrites", () => {
    expect(writingUserPrompt({ task: "proofread", text: "teh draft" })).toBe("Draft:\nteh draft");
  });
});

describe("threadToContext", () => {
  it("keeps the most recent part of a long thread", () => {
    const old = { from: "a", date: "d", text: "OLD".repeat(10_000), html: null };
    const recent = { from: "b", date: "d", text: "LATEST", html: null };
    const ctx = threadToContext([old, recent]);
    expect(ctx.length).toBe(MAX_CONTEXT_CHARS);
    expect(ctx.endsWith("LATEST")).toBe(true);
  });

  it("falls back to text from HTML", () => {
    expect(htmlToText("<style>p{}</style><p>Hi&nbsp;there</p><br>Bye")).toBe("Hi there\n\nBye");
  });

  it("leaves no tag behind when tags are nested or split", () => {
    expect(htmlToText("<scr<script>x</script>ipt>alert(1)</script>Hi")).toBe("Hi");
    expect(htmlToText("<<b>i>bold</i>")).toBe("bold");
    expect(htmlToText("1 < 2")).toBe("1  2");
  });
});

describe("senderName / senderAddress", () => {
  it("parses display-name addresses", () => {
    expect(senderName('"Ada Lovelace" <ada@x.com>')).toBe("Ada Lovelace");
    expect(senderName("<ada@x.com>")).toBe("ada@x.com");
    expect(senderName("ada@x.com")).toBe("ada@x.com");
    expect(senderAddress("Ada <ada@x.com>")).toBe("ada@x.com");
  });
});

describe("shortDate", () => {
  const now = new Date(2026, 8, 25, 15, 0);
  it("shows the year only for older mail", () => {
    expect(shortDate(new Date(2026, 8, 3).toISOString(), now)).not.toMatch(/26/);
    expect(shortDate(new Date(2024, 8, 3).toISOString(), now)).toMatch(/24/);
  });
});

describe("connect targets", () => {
  it("round-trips through the OAuth state", () => {
    for (const t of [
      { kind: "Project" as const, projectId: "p1" },
      { kind: "Shared" as const, accountId: "m1" },
      { kind: "Personal" as const },
    ]) {
      expect(parseConnectTarget(serializeConnectTarget(t))).toEqual(t);
    }
  });

  it("rejects unknown targets", () => {
    expect(parseConnectTarget("project:")).toBeNull();
    expect(parseConnectTarget("admin:x")).toBeNull();
    expect(parseConnectTarget("personal:someone-else")).toBeNull();
    expect(parseConnectTarget(null)).toBeNull();
  });
});

describe("wordDiff", () => {
  it("marks changed words and keeps the rest", () => {
    expect(wordDiff("Thanks for teh update", "Thanks for the update")).toEqual([
      { kind: "same", text: "Thanks for " },
      { kind: "removed", text: "teh" },
      { kind: "added", text: "the" },
      { kind: "same", text: " update" },
    ]);
  });

  it("round-trips both sides", () => {
    const before = "Can we meet\n\nTuesday at 3?";
    const after = "Could we meet on Tuesday at 3pm?";
    const parts = wordDiff(before, after)!;
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe(before);
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe(after);
  });
});

describe("recipientDirectory", () => {
  it("collects people and domains, most-seen first", () => {
    const dir = recipientDirectory(
      ['"Lovelace, Ada" <ada@x.com>, grace@navy.mil', "Ada <ADA@x.com>", "grace@navy.mil"],
      ["me@dali.dartmouth.edu"],
    );
    expect(dir.people).toEqual([
      { name: "Lovelace, Ada", address: "ada@x.com" },
      { name: "", address: "grace@navy.mil" },
    ]);
    expect(dir.domains.slice(0, 3)).toEqual(["x.com", "navy.mil", "dali.dartmouth.edu"]);
    expect(dir.domains).toContain("gmail.com");
  });
});

describe("addressSuggestions", () => {
  const known = [{ name: "Ada Lovelace", address: "ada@x.com" }];
  it("completes the domain after @", () => {
    expect(addressSuggestions("bob@gm", known, ["gmail.com", "x.com"]).map((s) => s.value)).toEqual(["bob@gmail.com"]);
  });
  it("matches known people by name", () => {
    expect(addressSuggestions("love", known, []).map((s) => s.value)).toEqual(["ada@x.com"]);
  });
  it("adds directory people after mailbox people, without duplicates", () => {
    const directory = [
      { name: "Ada Lovelace", address: "ada@x.com" },
      { name: "Adam Smith", address: "adam@dali.dartmouth.edu" },
    ];
    expect(addressSuggestions("ada", known, [], directory).map((s) => s.value)).toEqual([
      "ada@x.com",
      "adam@dali.dartmouth.edu",
    ]);
  });
  it("offers nothing for a finished address", () => {
    expect(addressSuggestions("ada@x.com", known, ["x.com"])).toEqual([]);
  });
});
