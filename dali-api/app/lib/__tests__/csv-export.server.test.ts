import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db");

import { runCsvExport } from "~/lib/csv-export.server";

describe("runCsvExport", () => {
  // Regression guard: every leaf of the registration barrel imports
  // defineCsvExport from csv-export.server, so importing the barrel from that
  // module's top level is a cycle — the leaves then call defineCsvExport while
  // `registry` is still in its TDZ and every export request 500s with "Cannot
  // access 'registry' before initialization". Any call loads the barrel, so
  // this fails if the import moves back to module scope.
  it("loads the registration barrel and 404s an unknown export", async () => {
    const res = await runCsvExport(
      "no-such-export",
      new Request("http://localhost/api/export/no-such-export/export.csv"),
      {},
    );

    expect(res.status).toBe(404);
  });
});
