import { describe, it, expect, afterEach } from "vitest";
import { loader as asLoader } from "~/routes/well-known.oauth-authorization-server";
import { loader as prLoader } from "~/routes/well-known.oauth-protected-resource";

// MCP clients build their authorization request from scopes_supported, so a
// scope missing here is one no connector ever asks for.
describe("OAuth metadata scopes_supported", () => {
  const req = () => ({ request: new Request("http://localhost/.well-known/x") }) as any;

  it("advertises mcp:admin from the authorization server metadata", async () => {
    const body = await (await asLoader(req())).json();
    expect(body.scopes_supported).toEqual(["mcp:read", "mcp:write", "mcp:admin"]);
  });

  it("advertises mcp:admin from the protected resource metadata", async () => {
    const body = await (await prLoader(req())).json();
    expect(body.scopes_supported).toEqual(["mcp:read", "mcp:write", "mcp:admin"]);
  });
});

// ChatGPT sends its one stable connector callback only to issuers that do RFC
// 9207 issuer identification, and compares `iss` to the metadata `issuer` by
// exact string. Both documents must therefore agree byte-for-byte.
describe("RFC 9207 issuer identification", () => {
  const req = (url = "http://localhost/.well-known/x") =>
    ({ request: new Request(url) }) as any;

  afterEach(() => {
    delete process.env.API_BASE_URL;
  });

  it("advertises authorization_response_iss_parameter_supported", async () => {
    const body = await (await asLoader(req())).json();
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
  });

  it("uses the same issuer string in both metadata documents", async () => {
    process.env.API_BASE_URL = "https://os.dali.dartmouth.edu";
    const as = await (await asLoader(req())).json();
    const pr = await (await prLoader(req())).json();
    expect(as.issuer).toBe("https://os.dali.dartmouth.edu");
    expect(pr.authorization_servers).toEqual([as.issuer]);
  });

  it("strips a trailing slash so iss can match byte-for-byte", async () => {
    process.env.API_BASE_URL = "https://os.dali.dartmouth.edu/";
    const as = await (await asLoader(req())).json();
    const pr = await (await prLoader(req())).json();
    expect(as.issuer).toBe("https://os.dali.dartmouth.edu");
    expect(as.authorization_endpoint).toBe(
      "https://os.dali.dartmouth.edu/oauth/authorize",
    );
    expect(pr.authorization_servers).toEqual([as.issuer]);
  });

  it("falls back to the request origin when API_BASE_URL is unset", async () => {
    const as = await (
      await asLoader(req("https://preview-pr-1.fly.dev/.well-known/x"))
    ).json();
    expect(as.issuer).toBe("https://preview-pr-1.fly.dev");
  });
});
