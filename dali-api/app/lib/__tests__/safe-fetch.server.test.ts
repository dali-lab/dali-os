import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("node:dns", () => ({ lookup: hoisted.resolve }));

import { pinnedFetch, publicOnlyLookup } from "../safe-fetch.server";

const answer = (...addresses: string[]) =>
  hoisted.resolve.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: null, a: { address: string; family: number }[]) => void;
    cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  });

const lookupOnce = (host: string, all = false) =>
  new Promise<unknown>((resolve, reject) =>
    (publicOnlyLookup as unknown as (h: string, o: unknown, cb: (e: Error | null, a?: unknown) => void) => void)(host, { all }, (e, a) =>
      e ? reject(e) : resolve(a),
    ),
  );

describe("publicOnlyLookup", () => {
  beforeEach(() => {
    hoisted.resolve.mockReset();
  });

  it("returns public addresses", async () => {
    answer("93.184.216.34");
    expect(await lookupOnce("example.com")).toBe("93.184.216.34");
    expect(await lookupOnce("example.com", true)).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses private, loopback and metadata addresses", async () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1", "::1"]) {
      answer(ip);
      await expect(lookupOnce("example.com"), ip).rejects.toThrow("Blocked address");
    }
  });

  it("refuses a name that resolves to a mix of public and private addresses", async () => {
    answer("93.184.216.34", "10.0.0.5");
    await expect(lookupOnce("example.com")).rejects.toThrow("Blocked address");
  });

  it("refuses an empty answer", async () => {
    answer();
    await expect(lookupOnce("example.com")).rejects.toThrow("Blocked address");
  });
});

describe("pinnedFetch", () => {
  it("refuses at connect time when the host now resolves privately", async () => {
    answer("10.0.0.5");
    await expect(pinnedFetch(new URL("https://rebind.example.com/"), { timeoutMs: 1000 })).rejects.toThrow("Blocked address");
    expect(hoisted.resolve).toHaveBeenCalled();
  });
});
