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

function findByPath(entries: Entry[], path: string): Entry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const hit = entry.children ? findByPath(entry.children, path) : null;
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

  // Core ▸ Communications ▸ Email is the only nav entry the email editor has,
  // so that URL has to render the editor. It was served by the redirect stub,
  // which bounced the click into /admin/email — swapping the sidebar to Admin
  // and leaving no tab highlighted.
  it("serves the email editor on its Core url, not a redirect stub", () => {
    expect(findByPath(routes as Entry[], "core/communications/email")?.file).toBe(
      "core/routes/core.communications.email.tsx",
    );
    // /admin/email keeps a route of its own so the source loader can redirect
    // with `?key=` intact; the older addresses go through the stub.
    expect(findByPath(routes as Entry[], "admin/email")?.file).toBe(
      "admin/routes/admin.email.tsx",
    );
    for (const old of ["admin/email-templates", "hiring/emails"]) {
      expect(findByPath(routes as Entry[], old)?.file).toBe(
        "admin/routes/admin.email.legacy-redirect.ts",
      );
    }
  });
});
