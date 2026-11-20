import { describe, expect, it } from "vitest";
import { csvCell, rowsToCsv } from "../csv";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
  });

  it("prefixes text that a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+cmd|x")).toBe("'+cmd|x");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvCell("\rx")).toBe("\"'\rx\"");
  });

  it("leaves numbers and plain numeric strings alone", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(0)).toBe("0");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("+1")).toBe("+1");
    expect(csvCell("1e5")).toBe("1e5");
  });

  it("leaves ordinary text alone", () => {
    expect(csvCell("Ada Lovelace")).toBe("Ada Lovelace");
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("rowsToCsv", () => {
  it("escapes every cell", () => {
    expect(rowsToCsv([["Ada", "=1+1", -3]])).toBe("Ada,'=1+1,-3\r\n");
  });
});
