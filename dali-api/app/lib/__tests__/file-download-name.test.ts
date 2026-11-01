import { describe, expect, it } from "vitest";
import { downloadFileName, uniqueNames } from "~/lib/file-download-name";

describe("downloadFileName", () => {
  it("uses the title and keeps the upload's extension after a rename", () => {
    expect(downloadFileName("Q3 budget", "uuid-draft.xlsx")).toBe("Q3 budget.xlsx");
  });

  it("doesn't double an extension the title already has", () => {
    expect(downloadFileName("Deck.PDF", "deck.pdf")).toBe("Deck.PDF");
  });

  it("falls back to the uploaded name, then to a default", () => {
    expect(downloadFileName("", "deck.pdf")).toBe("deck.pdf");
    expect(downloadFileName("  ", "  ")).toBe("file");
  });

  it("leaves a name with no extension alone", () => {
    expect(downloadFileName("Notes", "README")).toBe("Notes");
  });

  it("can't name a path outside the archive", () => {
    expect(downloadFileName("../../etc/passwd", "a.txt")).toBe("_.._etc_passwd.txt");
    expect(downloadFileName("..\\win", "a.txt")).toBe("_win.txt");
    expect(downloadFileName("/abs", "a.txt")).toBe("_abs.txt");
  });

  it("strips characters filesystems refuse and control characters", () => {
    expect(downloadFileName('a:b*c?"d<e>f|g\u0000h', "x.txt")).toBe("a_b_c__d_e_f_gh.txt");
  });

  it("drops leading dots so a title can't make a hidden file", () => {
    expect(downloadFileName("..hidden", "a.txt")).toBe("hidden.txt");
  });

  it("keeps non-ASCII titles", () => {
    expect(downloadFileName("Résumé 日本語", "a.pdf")).toBe("Résumé 日本語.pdf");
  });

  it("caps long names without losing the extension or splitting an emoji", () => {
    const name = downloadFileName("😀".repeat(300), "a.pdf");
    expect([...name]).toHaveLength(200);
    expect(name.endsWith("😀.pdf")).toBe(true);
    expect(() => encodeURIComponent(name)).not.toThrow();
  });
});

describe("uniqueNames", () => {
  it("numbers repeats before the extension", () => {
    expect(uniqueNames(["a.pdf", "a.pdf", "a.pdf"])).toEqual(["a.pdf", "a (1).pdf", "a (2).pdf"]);
  });

  it("treats names differing only by case as repeats", () => {
    expect(uniqueNames(["A.pdf", "a.PDF"])).toEqual(["A.pdf", "a (1).PDF"]);
  });

  it("skips a number another file already holds", () => {
    expect(uniqueNames(["a (1).pdf", "a.pdf", "a.pdf"])).toEqual(["a (1).pdf", "a.pdf", "a (2).pdf"]);
  });

  it("handles names with no extension", () => {
    expect(uniqueNames(["notes", "notes"])).toEqual(["notes", "notes (1)"]);
  });
});
