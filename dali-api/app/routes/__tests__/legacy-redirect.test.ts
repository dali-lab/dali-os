import { describe, expect, it } from "vitest";
import { loader } from "../legacy-redirect";

const run = (url: string) => loader({ request: new Request(url) });

describe("legacy-redirect loader", () => {
  it("redirects with the table's status and keeps the query", () => {
    const res = run("http://localhost/admin/outbound-messages?status=Dead&q=x");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/admin/messaging/outbox?status=Dead&q=x");
  });

  it("uses a temporary redirect where the old URL always did", () => {
    const res = run("http://localhost/projects/level-up/u1?term=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/core/level-up/u1?term=x");
  });

  it("answers 404 for a path the table does not know", () => {
    expect(() => run("http://localhost/admin/members")).toThrow();
  });
});
