import { describe, it, expect } from "vitest";
import {
  ALIAS,
  matchProject,
  normalizeName,
  parseUrl,
  parseYear,
  parseStatus,
  multiSelect,
  toShowcaseFields,
} from "../lib/showcase-csv";

function projects(...names: string[]) {
  return new Map(
    names.map((name) => [normalizeName(name), { id: `id:${name}`, name }]),
  );
}

describe("normalizeName", () => {
  it("ignores the ways the two systems spell the same project", () => {
    // Spacing, case, punctuation, and accents all differ between the Notion
    // showcase and DALI OS; none of it is meaningful.
    expect(normalizeName("TheatreVR")).toBe(normalizeName("Theatre VR"));
    expect(normalizeName("Inforest")).toBe(normalizeName("InForest"));
    expect(normalizeName("LinkVT")).toBe(normalizeName("Link VT"));
    expect(normalizeName("ITC D-Plan Petition")).toBe(
      normalizeName("ITC D Plan Petition"),
    );
    expect(normalizeName("TeachDELTA")).toBe(normalizeName("TeachDelta"));
    expect(normalizeName("Mavis  Tire")).toBe(normalizeName("MavisTire"));
    expect(normalizeName("Dalí Museum")).toBe(normalizeName("Dali Museum"));
  });

  it("still separates genuinely different projects", () => {
    expect(normalizeName("EQ2")).not.toBe(normalizeName("EQ2 videos"));
    expect(normalizeName("Pine Beetle V2")).not.toBe(normalizeName("Pine Beetle V3"));
  });
});

describe("matchProject", () => {
  it("matches on name once spelling noise is stripped", () => {
    const result = matchProject("TheatreVR", projects("Theatre VR"));
    expect(result).toEqual({
      kind: "exact",
      projectId: "id:Theatre VR",
      projectName: "Theatre VR",
    });
  });

  it("uses the hand-checked alias table when names diverge", () => {
    const result = matchProject("AIPA", projects("AI Patient Actor"));
    expect(result).toEqual({
      kind: "alias",
      projectId: "id:AI Patient Actor",
      projectName: "AI Patient Actor",
    });
  });

  it("plans a new project when nothing matches", () => {
    // Arsenic (2016) predates DALI OS but is live on dali.website today, so it
    // must not be dropped.
    expect(matchProject("Arsenic", projects("Auracle"))).toEqual({ kind: "create" });
  });

  it("never guesses a fuzzy match", () => {
    // "EQ2 videos" is a distinct showcase row from "EQ2". Substring matching
    // would happily link them and publish one under the other's name.
    expect(matchProject("EQ2 videos", projects("EQ2"))).toEqual({ kind: "create" });
    expect(matchProject("WISE Video", projects("WISE Animation"))).toEqual({
      kind: "create",
    });
  });

  it("skips rows with no name rather than creating an untitled project", () => {
    // One row in the export ("Sprout App") is blank in every column.
    expect(matchProject("", projects("Anything"))).toEqual({
      kind: "skip",
      reason: "no Project Name",
    });
  });

  it("refuses to create when an alias points at a project that is gone", () => {
    // A stale alias must fail loudly. Falling through to `create` would make a
    // duplicate of the very project the table exists to point at.
    const result = matchProject("AIPA", projects("Something Else"));
    expect(result.kind).toBe("skip");
    expect((result as { reason: string }).reason).toContain("AI Patient Actor");
  });

  it("has no alias entry that shadows a name that would already match", () => {
    // A redundant alias is a smell: it means the pair differs only by
    // normalization noise and the table entry is dead weight.
    for (const [from, to] of Object.entries(ALIAS)) {
      expect(normalizeName(from), `${from} → ${to} is redundant`).not.toBe(
        normalizeName(to),
      );
    }
  });
});

describe("parseYear", () => {
  it("accepts a plain calendar year", () => {
    expect(parseYear("2020")).toBe(2020);
  });

  it("rejects blanks and non-years", () => {
    expect(parseYear("")).toBeNull();
    expect(parseYear("  ")).toBeNull();
    expect(parseYear("20F")).toBeNull();
    // One row's cell holds a pasted Notion URL rather than a year.
    expect(parseYear("https://app.notion.com/p/25F-Link-VT")).toBeNull();
  });
});

describe("parseUrl", () => {
  it("adds a scheme to the bare hostnames Notion stored", () => {
    expect(parseUrl("shapethefuture.dartmouth.edu")).toBe(
      "https://shapethefuture.dartmouth.edu",
    );
    expect(parseUrl("doc.dartmouth.edu/")).toBe("https://doc.dartmouth.edu/");
  });

  it("keeps an already-absolute URL as-is", () => {
    expect(parseUrl("https://simreach.com")).toBe("https://simreach.com");
    expect(parseUrl("http://arsenic.dali.dartmouth.edu")).toBe(
      "http://arsenic.dali.dartmouth.edu",
    );
  });

  it("rejects prose that was typed into a link cell", () => {
    // Real cells from the export.
    expect(parseUrl("add link to the D article (ask erica)")).toBeNull();
    expect(parseUrl("Link the launched product or link to download.")).toBeNull();
    expect(parseUrl("Student-written case study on our Medium")).toBeNull();
    expect(parseUrl("")).toBeNull();
  });
});

describe("parseStatus", () => {
  it("maps Notion's vocabulary onto the enum", () => {
    expect(parseStatus("Published")).toBe("Published");
    expect(parseStatus("In Progress")).toBe("InProgress");
    expect(parseStatus("Not Started")).toBe("NotStarted");
    expect(parseStatus("Needs Review")).toBe("NeedsReview");
    expect(parseStatus("Archive")).toBe("Archive");
  });

  it("treats a blank or unknown status as untriaged, never as published", () => {
    expect(parseStatus("")).toBe("NotStarted");
    expect(parseStatus("Something New")).toBe("NotStarted");
  });
});

describe("multiSelect", () => {
  it("splits Notion's comma-joined multi-selects", () => {
    expect(multiSelect({ Partner: "Startup, Student Founder" }, "Partner")).toEqual([
      "Startup",
      "Student Founder",
    ]);
  });

  it("yields an empty list for a blank cell", () => {
    expect(multiSelect({ Partner: "" }, "Partner")).toEqual([]);
    expect(multiSelect({}, "Partner")).toEqual([]);
  });
});

describe("toShowcaseFields", () => {
  it("maps a real export row", () => {
    const fields = toShowcaseFields({
      Statement: "Assessing personal risk during COVID",
      "Project Name": "CoRisk",
      "Year in DALI": "2020",
      Status: "Published",
      Partner: "Startup, Student Founder",
      Product: "Mobile",
      Sector: "Health",
      "Tech Stack": "Node/Express, React Native",
      "Logo Image": "Projects%20Showcase/Frame_266.png",
      "Link to App": "",
      "Link to Website": "",
      "Student Blog": "",
      Press: "",
    });

    expect(fields).toEqual({
      displayName: "CoRisk",
      tagline: "Assessing personal risk during COVID",
      year: 2020,
      status: "Published",
      partners: ["Startup", "Student Founder"],
      products: ["Mobile"],
      sectors: ["Health"],
      techStack: ["Node/Express", "React Native"],
      appUrl: null,
      websiteUrl: null,
      blogUrl: null,
      pressUrl: null,
      logoImagePath: "Projects%20Showcase/Frame_266.png",
    });
  });
});
