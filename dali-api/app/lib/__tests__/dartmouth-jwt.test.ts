import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDartmouthJwt,
  __resetDartmouthJwtCacheForTests,
} from "~/lib/dartmouth-jwt";

// Build a fake JWT whose middle segment decodes to { exp } at the given
// epoch seconds. Signature is irrelevant — we never verify it locally.
function fakeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
    "base64url",
  );
  return `${header}.${payload}.sig`;
}

describe("getDartmouthJwt", () => {
  const realFetch = global.fetch;
  const originalKey = process.env.DARTMOUTH_API_KEY;

  beforeEach(() => {
    __resetDartmouthJwtCacheForTests();
    global.fetch = vi.fn();
    process.env.DARTMOUTH_API_KEY = "test-api-key";
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (originalKey === undefined) delete process.env.DARTMOUTH_API_KEY;
    else process.env.DARTMOUTH_API_KEY = originalKey;
  });

  function mockExchange(jwt: string, accepted_scopes: string[]) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ jwt, accepted_scopes }), { status: 200 }),
    );
  }

  it("exchanges the API key and returns the JWT", async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockExchange(jwt, ["urn:dartmouth:people:read.sensitive"]);
    const result = await getDartmouthJwt();
    expect(result).toBe(jwt);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain("api.dartmouth.edu/api/jwt");
    expect(call[0]).toContain("urn%3Adartmouth%3Apeople%3Aread.sensitive");
    expect((call[1] as RequestInit).method).toBe("POST");
    // Raw key — no "Bearer" prefix.
    expect((call[1] as RequestInit).headers).toEqual({
      Authorization: "test-api-key",
    });
  });

  it("caches subsequent calls until close to expiry", async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockExchange(jwt, ["urn:dartmouth:people:read.sensitive"]);

    await getDartmouthJwt();
    await getDartmouthJwt();
    await getDartmouthJwt();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-exchanges once cached JWT is past the refresh buffer", async () => {
    // First JWT expires in 2 minutes — within the 5-minute refresh buffer,
    // so the next call must re-exchange.
    const stale = fakeJwt(Math.floor(Date.now() / 1000) + 120);
    const fresh = fakeJwt(Math.floor(Date.now() / 1000) + 3600);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jwt: stale,
            accepted_scopes: ["urn:dartmouth:people:read.sensitive"],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jwt: fresh,
            accepted_scopes: ["urn:dartmouth:people:read.sensitive"],
          }),
          { status: 200 },
        ),
      );

    expect(await getDartmouthJwt()).toBe(stale);
    expect(await getDartmouthJwt()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when required scope was not granted", async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockExchange(jwt, ["urn:dartmouth:something:else"]);
    await expect(getDartmouthJwt()).rejects.toThrow(/scope.*not granted/);
  });

  it("throws when DARTMOUTH_API_KEY is unset", async () => {
    delete process.env.DARTMOUTH_API_KEY;
    await expect(getDartmouthJwt()).rejects.toThrow(/DARTMOUTH_API_KEY/);
  });

  it("throws on non-OK exchange response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    );
    await expect(getDartmouthJwt()).rejects.toThrow(/403/);
  });
});
