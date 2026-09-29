import { describe, it, expect } from "vitest";
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
