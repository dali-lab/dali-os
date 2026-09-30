import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/dartmouth-jwt", () => ({
  getDartmouthJwt: vi.fn(async () => "fake.jwt.token"),
}));

import {
  emailAddressesByNetId,
  parseEmailAddresses,
  DartmouthEmailApiError,
} from "~/lib/dartmouth-email-addresses";

// Verbatim from the Dartmouth developer portal's sample return for
// /api/email_addresses?netid=d11111a. Note both rows carry is_primary: false
// while one is plainly the preferred address — the reason `preferred` is
// derived from the Advancement markers rather than is_primary alone.
const SAMPLE = [
  {
    id: "601177f19948a0a6209256dc",
    netid: "d11111a",
    email_address: "jordan.m.lee.24@dartmouth.edu",
    data_source: "adv",
    is_primary: false,
    data_source_data: {
      type: "Dartmouth Email",
      is_preferred_ind: false,
      is_for_vitalyst: false,
      forwards_to_email_address: null,
    },
    cache_date: "2021-05-17T00:00:23Z",
  },
  {
    id: "601177f19948a0a6209256dd",
    netid: "d11111a",
    email_address: "jordan.m.lee.24@dartmouth.edu",
    data_source: "adv",
    is_primary: false,
    data_source_data: {
      type: "Preferred Email",
      is_preferred_ind: true,
      is_for_vitalyst: false,
      forwards_to_email_address: null,
    },
    cache_date: "2021-05-17T00:00:23Z",
  },
];

const realFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof global.fetch;
});
afterEach(() => {
  global.fetch = realFetch;
  vi.clearAllMocks();
});

function respond(body: unknown, status = 200) {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("parseEmailAddresses", () => {
  it("collapses the per-type duplicate rows into one address", () => {
    // Advancement emits one row per type for the same mailbox. Two UserEmail
    // rows for one address would collide on the unique constraint.
    const parsed = parseEmailAddresses(SAMPLE);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].address).toBe("jordan.m.lee.24@dartmouth.edu");
  });

  it("derives preferred from the Advancement markers, not is_primary", () => {
    expect(parseEmailAddresses(SAMPLE)[0].preferred).toBe(true);
  });

  it("lowercases addresses", () => {
    expect(
      parseEmailAddresses([{ netid: "d99999z", email_address: "alex.t.rivera.27@dartmouth.edu" }])[0]
        .address,
    ).toBe("alex.t.rivera.27@dartmouth.edu");
  });

  it("skips records with no usable address", () => {
    expect(parseEmailAddresses([{ netid: "x" }, { email_address: "   " }])).toEqual([]);
  });

  it("accepts a paged envelope as well as a bare array", () => {
    expect(parseEmailAddresses({ data: SAMPLE })).toHaveLength(1);
  });
});

describe("emailAddressesByNetId", () => {
  it("returns preferred addresses first", async () => {
    respond([
      { netid: "d99999z", email_address: "old.alias@dartmouth.edu", is_primary: false },
      { netid: "d99999z", email_address: "alex.t.rivera.27@dartmouth.edu", is_primary: true },
    ]);

    const out = await emailAddressesByNetId("D99999Z");
    expect(out.map((e) => e.address)).toEqual([
      "alex.t.rivera.27@dartmouth.edu",
      "old.alias@dartmouth.edu",
    ]);
  });

  it("sends the JWT and queries by netid", async () => {
    respond([]);
    await emailAddressesByNetId("d99999z");

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("netid=d99999z");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer fake.jwt.token",
    });
  });

  it("treats 404 as no addresses on file", async () => {
    respond("", 404);
    expect(await emailAddressesByNetId("nobody")).toEqual([]);
  });

  it("names the missing scope on 403 instead of reporting an empty result", async () => {
    // The scope is granted by Advancement IT against our API key. Until then
    // every call fails, and silently returning [] would read as "this person
    // has no addresses" across the entire sweep.
    respond("", 403);
    await expect(emailAddressesByNetId("d99999z")).rejects.toThrow(
      /email_addresses:read\.adv/,
    );
  });

  it("surfaces a transport failure rather than swallowing it", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNRESET"));
    await expect(emailAddressesByNetId("d99999z")).rejects.toBeInstanceOf(
      DartmouthEmailApiError,
    );
  });

  it("ignores rows attributed to a different netid", async () => {
    respond([{ netid: "someoneelse", email_address: "not.theirs@dartmouth.edu" }]);
    expect(await emailAddressesByNetId("d99999z")).toEqual([]);
  });
});
