import { describe, expect, it } from "vitest";
import { matchRoutes } from "react-router";
import { loader } from "../connect-redirect";

const visit = (path: string) => {
  const url = `https://os.example.edu${path}`;
  const match = matchRoutes([{ path: "connect/*" }], new URL(url).pathname)?.[0];
  if (!match) return null;
  return loader({ request: new Request(url), params: match.params });
};

describe("/connect", () => {
  it("permanently redirects to /community", () => {
    const res = visit("/connect")!;
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/community");
  });

  it("keeps the query, so saved event links still open the event", () => {
    expect(visit("/connect?event=ev1")!.headers.get("Location")).toBe("/community?event=ev1");
  });

  it("keeps the rest of the path", () => {
    expect(visit("/connect/events/ev1/calendar.ics")!.headers.get("Location")).toBe(
      "/community/events/ev1/calendar.ics",
    );
  });

  it("leaves other paths alone", () => {
    expect(visit("/connections")).toBeNull();
  });
});
