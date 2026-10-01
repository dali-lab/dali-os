import { describe, expect, it } from "vitest";
import { folderQuery, mailFolder } from "~/email/lib/folders";

describe("mail folders", () => {
  it("falls back to the inbox for an unknown folder", () => {
    expect(mailFolder("nope").key).toBe("inbox");
    expect(mailFolder(null).key).toBe("inbox");
  });

  it("lists a folder by its own query, and all mail with none", () => {
    expect(folderQuery(mailFolder("sent"), "")).toBe("in:sent");
    expect(folderQuery(mailFolder("all"), "")).toBe("");
  });

  it("searches all mail from the inbox but stays inside any other folder", () => {
    expect(folderQuery(mailFolder("inbox"), "budget")).toBe("budget");
    expect(folderQuery(mailFolder("trash"), "budget")).toBe("in:trash budget");
    expect(folderQuery(mailFolder("all"), "budget")).toBe("budget");
  });

  it("asks Gmail for spam and trash only in those folders", () => {
    expect(mailFolder("trash").spamTrash).toBe(true);
    expect(mailFolder("spam").spamTrash).toBe(true);
    expect(mailFolder("sent").spamTrash).toBe(false);
  });
});
