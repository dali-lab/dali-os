import { describe, it, expect } from "vitest";
import { loader } from "~/hiring/routes/lead.internal-cycle.$id";

describe("lead.internal-cycle.$id", () => {
  it("redirects old links to the shared setup page, keeping the query", async () => {
    const res = (await loader({
      request: new Request("http://localhost/hiring/lead/internal-cycle/cycle-1?tab=decisions"),
      params: { id: "cycle-1" },
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/hiring/lead/cycle/cycle-1?tab=decisions");
  });
});
