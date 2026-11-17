import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/s3.server", () => ({ putObject: vi.fn() }));

import {
  checkJobLinkAlive,
  cleanLegalName,
  copyLogoToS3,
  mapJobType,
  registrableDomain,
  resolveJobLink,
} from "~/community/lib/job-link.server";

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const page = (head: string) => `<html><head>${head}</head><body></body></html>`;
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

const publicLookup = async () => [{ address: "93.184.216.34" }];

function deps(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const u = String(input);
    calls.push(u);
    const route = routes[u];
    return route ? route() : new Response("nope", { status: 404 });
  });
  return { calls, deps: { fetch: fetchFn as unknown as typeof fetch, lookup: publicLookup } };
}

const posting = (over: Record<string, unknown> = {}) => ({
  "@type": "JobPosting",
  title: "Software Engineer",
  employmentType: "FULL_TIME",
  jobLocation: { address: { addressLocality: "Boston", addressRegion: "MA" } },
  ...over,
});

describe("resolveJobLink by site", () => {
  it("reads Ashby JSON-LD and ignores og:image", async () => {
    const url = "https://jobs.ashbyhq.com/acme/123";
    const { deps: d } = deps({
      [url]: () =>
        html(
          page(
            `<meta property="og:image" content="https://jobs.ashbyhq.com/social-card.png">` +
              ld(posting({ hiringOrganization: { name: "Acme", sameAs: "https://www.acme.com", logo: "https://cdn.ashby.com/acme.png" } })),
          ),
        ),
    });
    expect(await resolveJobLink(url, d)).toEqual({
      url,
      companyName: "Acme",
      companyDomain: "acme.com",
      role: "Software Engineer",
      location: "Boston, MA",
      jobType: "Full time",
      logoSourceUrl: "https://cdn.ashby.com/acme.png",
    });
  });

  it("reads Lever JSON-LD with no website", async () => {
    const url = "https://jobs.lever.co/acme/abc";
    const { deps: d } = deps({
      [url]: () => html(page(ld(posting({ hiringOrganization: { name: "Acme Co", logo: "https://lever-cdn.com/l.png" } })))),
    });
    const r = await resolveJobLink(url, d);
    expect(r).toMatchObject({ companyName: "Acme Co", companyDomain: null, logoSourceUrl: "https://lever-cdn.com/l.png" });
  });

  it("uses og:image and the boards API for Greenhouse", async () => {
    const url = "https://job-boards.greenhouse.io/acme/jobs/9";
    const { deps: d, calls } = deps({
      [url]: () => html(page(`<meta property="og:image" content="https://s3.example.com/acme-logo.png"><meta property="og:title" content="Designer">`)),
      "https://boards-api.greenhouse.io/v1/boards/acme": () => html(JSON.stringify({ name: "Acme Robotics" })),
    });
    const r = await resolveJobLink(url, d);
    expect(r).toMatchObject({ companyName: "Acme Robotics", role: "Designer", logoSourceUrl: "https://s3.example.com/acme-logo.png" });
    expect(calls).toContain("https://boards-api.greenhouse.io/v1/boards/acme");
  });

  it("falls back to the slug when the Greenhouse API fails", async () => {
    const url = "https://boards.greenhouse.io/acme-labs/jobs/9";
    const { deps: d } = deps({ [url]: () => html(page("")) });
    expect((await resolveJobLink(url, d))?.companyName).toBe("Acme Labs");
  });

  it("cleans the Workday legal entity name and uses og:image", async () => {
    const url = "https://nvidia.wd5.myworkdayjobs.com/en-US/site/job/x";
    const { deps: d } = deps({
      [url]: () =>
        html(
          page(
            `<meta property="og:image" content="https://nvidia.wd5.myworkdayjobs.com/assets/logo">` +
              ld(posting({ hiringOrganization: { name: "2100 NVIDIA USA", sameAs: "" } })),
          ),
        ),
    });
    expect(await resolveJobLink(url, d)).toMatchObject({
      companyName: "NVIDIA",
      companyDomain: null,
      logoSourceUrl: "https://nvidia.wd5.myworkdayjobs.com/assets/logo",
    });
  });

  it("treats another host's own domain as the company and uses its largest icon", async () => {
    const url = "https://careers.airbnb.com/positions/1";
    const { deps: d } = deps({
      [url]: () =>
        html(
          page(
            `<meta property="og:site_name" content="Airbnb Careers">` +
              `<link rel="icon" href="/small.png" sizes="16x16">` +
              `<link rel="apple-touch-icon" href="/touch.png" sizes="180x180">`,
          ),
        ),
    });
    expect(await resolveJobLink(url, d)).toMatchObject({
      companyName: "Airbnb Careers",
      companyDomain: "airbnb.com",
      logoSourceUrl: "https://careers.airbnb.com/touch.png",
    });
  });

  it("does not fetch LinkedIn", async () => {
    const { deps: d, calls } = deps({});
    const r = await resolveJobLink("https://www.linkedin.com/jobs/view/1", d);
    expect(r).toMatchObject({ companyName: null, logoSourceUrl: null, companyDomain: null });
    expect(calls).toEqual([]);
  });
});

describe("job site branding", () => {
  it("never uses the job site's own favicon", async () => {
    const url = "https://apply.workable.com/acme/j/1";
    const { deps: d } = deps({
      [url]: () => html(page(`<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/t.png">` + ld(posting({ hiringOrganization: { name: "Acme" } })))),
    });
    expect(await resolveJobLink(url, d)).toMatchObject({ companyName: "Acme", logoSourceUrl: null, companyDomain: null });
  });

  it("drops an icon hosted on a job site", async () => {
    const url = "https://careers.acme.com/1";
    const { deps: d } = deps({
      [url]: () => html(page(`<link rel="icon" href="https://www.greenhouse.io/favicon.ico">`)),
    });
    expect((await resolveJobLink(url, d))?.logoSourceUrl).toBeNull();
  });
});

describe("safety", () => {
  it("rejects non-https urls", async () => {
    const { deps: d, calls } = deps({});
    expect(await resolveJobLink("http://acme.com/jobs", d)).toBeNull();
    expect(await resolveJobLink("not a url", d)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("rejects hosts resolving to private addresses", async () => {
    const { deps: d, calls } = deps({});
    const priv = { ...d, lookup: async () => [{ address: "10.0.0.5" }] };
    expect(await resolveJobLink("https://internal.acme.com/x", priv)).toBeNull();
    expect(await resolveJobLink("https://127.0.0.1/x", d)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("re-checks each redirect hop", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.acme.com/x" } }));
    const lookup = async (host: string) => [{ address: host.startsWith("evil") ? "192.168.1.1" : "93.184.216.34" }];
    const status = await checkJobLinkAlive("https://acme.com/a", { fetch: fetchFn as unknown as typeof fetch, lookup });
    expect(status).toBe("unknown");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("follows at most 3 redirects", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://acme.com/next" } }));
    const status = await checkJobLinkAlive("https://acme.com/a", { fetch: fetchFn as unknown as typeof fetch, lookup: publicLookup });
    expect(status).toBe("unknown");
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

describe("checkJobLinkAlive", () => {
  const check = (status: number) =>
    checkJobLinkAlive("https://acme.com/j", {
      fetch: (async () => new Response("x", { status })) as unknown as typeof fetch,
      lookup: publicLookup,
    });

  it("maps statuses", async () => {
    expect(await check(200)).toBe("alive");
    expect(await check(404)).toBe("dead");
    expect(await check(410)).toBe("dead");
    expect(await check(403)).toBe("unknown");
    expect(await check(500)).toBe("unknown");
  });

  it("is unknown on network errors", async () => {
    const status = await checkJobLinkAlive("https://acme.com/j", {
      fetch: (async () => {
        throw new Error("timeout");
      }) as unknown as typeof fetch,
      lookup: publicLookup,
    });
    expect(status).toBe("unknown");
  });
});

describe("copyLogoToS3", () => {
  const img = (type: string, bytes = 10) =>
    (async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } })) as unknown as typeof fetch;

  it("stores an image under the uploads logo prefix", async () => {
    const put = vi.fn(async () => {});
    const key = await copyLogoToS3("https://cdn.acme.com/l.png", { fetch: img("image/png"), lookup: publicLookup, putObject: put, uuid: () => "u-1" });
    expect(key).toBe("uploads/opportunities/logos/u-1.png");
    expect(put).toHaveBeenCalledWith(key, expect.any(Uint8Array), "image/png");
  });

  it("rejects non-image content", async () => {
    const put = vi.fn();
    expect(await copyLogoToS3("https://cdn.acme.com/l", { fetch: img("text/html"), lookup: publicLookup, putObject: put })).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects images over 2 MB", async () => {
    const put = vi.fn();
    expect(await copyLogoToS3("https://cdn.acme.com/l.png", { fetch: img("image/png", 2 * 1024 * 1024 + 1), lookup: publicLookup, putObject: put })).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses private hosts and http", async () => {
    const put = vi.fn();
    const priv = async () => [{ address: "10.1.1.1" }];
    expect(await copyLogoToS3("https://cdn.acme.com/l.png", { fetch: img("image/png"), lookup: priv, putObject: put })).toBeNull();
    expect(await copyLogoToS3("http://cdn.acme.com/l.png", { fetch: img("image/png"), lookup: publicLookup, putObject: put })).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("returns null when storage fails", async () => {
    const put = vi.fn(async () => {
      throw new Error("s3 down");
    });
    expect(await copyLogoToS3("https://cdn.acme.com/l.png", { fetch: img("image/png"), lookup: publicLookup, putObject: put })).toBeNull();
  });
});

describe("helpers", () => {
  it("cleans legal names", () => {
    expect(cleanLegalName("2100 NVIDIA USA", "nvidia")).toBe("NVIDIA");
    expect(cleanLegalName("Acme Inc.", null)).toBe("Acme");
    expect(cleanLegalName("", "big-co")).toBe("Big Co");
  });

  it("maps job types", () => {
    expect(mapJobType("FULL_TIME")).toBe("Full time");
    expect(mapJobType(["PART_TIME"])).toBe("Part time");
    expect(mapJobType("INTERN")).toBe("Internship");
    expect(mapJobType("CONTRACTOR")).toBe("Contract");
    expect(mapJobType("OTHER")).toBeNull();
  });

  it("finds the registrable domain", () => {
    expect(registrableDomain("careers.airbnb.com")).toBe("airbnb.com");
    expect(registrableDomain("jobs.bbc.co.uk")).toBe("bbc.co.uk");
  });
});
