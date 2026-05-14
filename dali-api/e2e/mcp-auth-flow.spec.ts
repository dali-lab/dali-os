import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from './fixtures';

// End-to-end MCP auth: discovery → authorize (existing-session shortcut) →
// consent → token → /mcp whoami. Sidesteps the Google IDP stub by relying on
// the dev-login cookie + the /oauth/authorize existing-session branch.

function base64UrlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = base64UrlSha256(verifier);
  return { verifier, challenge };
}

test('MCP OAuth foundation: discovery, authorize, consent, token, whoami', async ({
  page,
  loginAs,
  request,
  baseURL,
}) => {
  // 1) Discovery
  const wellKnown = await request.get('/.well-known/oauth-authorization-server');
  expect(wellKnown.ok()).toBe(true);
  const meta = await wellKnown.json();
  expect(meta.authorization_endpoint).toContain('/oauth/authorize');
  expect(meta.token_endpoint).toContain('/oauth/token');
  expect(meta.code_challenge_methods_supported).toContain('S256');
  expect(meta.scopes_supported).toEqual(
    expect.arrayContaining(['mcp:read', 'mcp:write']),
  );

  // 2) Log in as a seeded member (dev-login → __dali_sid cookie).
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  // 3) Register an MCP client via RFC 7591 DCR. There are no seeded MCP
  //    OAuthClient rows — clients self-register.
  const redirectUri = 'http://127.0.0.1:51999/callback';
  const regIp = `10.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256,
  )}.${Math.floor(Math.random() * 256)}`;
  const regRes = await request.post('/oauth/register', {
    headers: { 'X-Forwarded-For': regIp },
    data: {
      redirect_uris: [redirectUri],
      client_name: 'Claude Code',
    },
  });
  expect(regRes.status()).toBe(200);
  const clientId = (await regRes.json()).client_id as string;

  // 4) Hit /oauth/authorize. Existing-session shortcut + no prior grant →
  //    redirects to /oauth/consent.
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(8).toString('hex');

  const authorizeUrl =
    `/oauth/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      provider: 'google',
      scope: 'mcp:read',
    });

  await page.goto(authorizeUrl);
  await expect(page).toHaveURL(/\/oauth\/consent\?session_id=/);
  await expect(page.getByRole('heading', { name: /Authorize Claude Code/ })).toBeVisible();

  // 4) Approve consent → redirect to loopback redirect_uri with ?code=&state=.
  //    Use page.request so navigation doesn't try to reach the loopback host.
  const sessionIdMatch = page.url().match(/session_id=([^&]+)/);
  expect(sessionIdMatch).not.toBeNull();
  const oauthSessionId = sessionIdMatch![1];

  const consentResponse = await page.request.post('/oauth/consent', {
    form: { session_id: oauthSessionId, decision: 'approve' },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(consentResponse.status()).toBeGreaterThanOrEqual(300);
  expect(consentResponse.status()).toBeLessThan(400);
  const loc = consentResponse.headers()['location'];
  expect(loc).toContain(redirectUri);
  const callbackUrl = new URL(loc);
  const code = callbackUrl.searchParams.get('code');
  expect(callbackUrl.searchParams.get('state')).toBe(state);
  expect(code).toBeTruthy();

  // 5) Exchange the code at /oauth/token.
  const tokenRes = await request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    },
  });
  expect(tokenRes.ok()).toBe(true);
  const tokenJson = await tokenRes.json();
  expect(tokenJson.token_type).toBe('Bearer');
  expect(typeof tokenJson.access_token).toBe('string');
  expect(tokenJson.scope).toContain('mcp:read');

  const bearer = tokenJson.access_token as string;

  // 6) Call /mcp whoami with the Bearer.
  const mcpRes = await request.post('/mcp', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    },
  });
  expect(mcpRes.ok()).toBe(true);
  const mcpJson = await mcpRes.json();
  expect(mcpJson.error).toBeUndefined();
  expect(mcpJson.result.structuredContent.daliEmail).toBe(
    'admin@dali.dartmouth.edu',
  );
  expect(mcpJson.result.structuredContent.tier).toBe('admin');
});

test('MCP requires a grant-backed session (cookie session is rejected)', async ({
  loginAs,
  request,
  page,
}) => {
  // First-party cookie session is NOT an MCP session.
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  const cookies = await page.context().cookies();
  const sid = cookies.find((c) => c.name === '__dali_sid')?.value;
  expect(sid).toBeTruthy();

  const res = await request.post('/mcp', {
    headers: {
      Authorization: `Bearer ${sid}`,
      'Content-Type': 'application/json',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(res.status()).toBe(401);
});
