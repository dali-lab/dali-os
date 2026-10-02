import { describe, it, expect } from "vitest";
import routes from "~/routes";

type Entry = { file?: string; path?: string; children?: Entry[] };

function findByFile(entries: Entry[], file: string): Entry | null {
  for (const entry of entries) {
    if (entry.file === file) return entry;
    const hit = entry.children ? findByFile(entry.children, file) : null;
    if (hit) return hit;
  }
  return null;
}

describe("routes config", () => {
  it("does not register auth/link-member", () => {
    const serialized = JSON.stringify(routes);
    expect(serialized).not.toContain("auth/link-member");
    expect(serialized).not.toContain("auth.link-member");
  });

  // The member layout bounces any account with no DALIMember row to /portal,
  // and most students in a course are plain Dartmouth accounts — nesting the
  // session check-in surface under it swallowed every QR scan.
  it("keeps education session check-in outside the member layout", () => {
    const file = "education/routes/education.check-in.$sessionId.tsx";
    const memberLayout = findByFile(routes as Entry[], "routes/layout.tsx");

    expect(findByFile(routes as Entry[], file)).not.toBeNull();
    expect(findByFile(memberLayout?.children ?? [], file)).toBeNull();
  });
});
