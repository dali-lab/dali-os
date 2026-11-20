import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/s3.server", () => ({ putObject: vi.fn() }));
vi.mock("node:dns", () => ({
  lookup: (_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) => cb(null, [{ address: "10.0.0.5", family: 4 }]),
}));

import { checkJobLinkAlive, copyLogoToS3 } from "~/community/lib/job-link.server";

const publicAtCheck = async () => [{ address: "93.184.216.34" }];

describe("job link DNS rebinding", () => {
  it("refuses a host that passes the pre-check but resolves privately at connect time", async () => {
    expect(await checkJobLinkAlive("https://rebind.acme.com/a", { lookup: publicAtCheck })).toBe("unknown");
    const put = vi.fn();
    expect(await copyLogoToS3("https://rebind.acme.com/l.png", { lookup: publicAtCheck, putObject: put })).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses private IP literals", async () => {
    expect(await checkJobLinkAlive("https://127.0.0.1/a", { lookup: publicAtCheck })).toBe("unknown");
    expect(await checkJobLinkAlive("https://[::1]/a", { lookup: publicAtCheck })).toBe("unknown");
  });
});
