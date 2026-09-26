import { describe, it, expect, afterEach } from "vitest";
import { loader } from "~/routes/well-known.apple-app-site-association";

const original = process.env.APPLE_TEAM_ID;
afterEach(() => {
  if (original === undefined) delete process.env.APPLE_TEAM_ID;
  else process.env.APPLE_TEAM_ID = original;
});

describe("GET /.well-known/apple-app-site-association", () => {
  it("serves webcredentials with <TeamID>.<bundle> as application/json", async () => {
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    const res = await loader();
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({
      webcredentials: { apps: ["ABCDE12345.edu.dartmouth.dali.os"] },
    });
  });

  it("returns valid JSON with an empty apps list when APPLE_TEAM_ID is unset", async () => {
    delete process.env.APPLE_TEAM_ID;
    const res = await loader();
    expect(await res.json()).toEqual({ webcredentials: { apps: [] } });
  });
});
