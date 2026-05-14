import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from './fixtures';

// RFC 7591 Dynamic Client Registration end-to-end: register a new MCP client,
// then drive the full authorize → consent → token → /mcp whoami flow with
// the registered client_id.

function base64UrlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = base64UrlSha256(verifier);
  return { verifier, challenge };
}

test('DCR: register → authorize → consent → token → /mcp whoami', async ({
  page,
  loginAs,
  request,
}) => {
  // 1) Register a new client.
  const redirectUri = 'http://127.0.0.1:54113/callback';
  const regRes = await request.post('/oauth/register', {
    data: {
      redirect_uris: [redirectUri],
      client_name: 'Claude Code E2E',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
  });
  expect(regRes.status()).toBe(200);
  const reg = await regRes.json();
  expect(typeof reg.client_id).toBe('string');
  expect(reg.client_id.length).toBeGreaterThan(0);
  expect(reg.client_name).toBe('Claude Code E2E');
  expect(reg.redirect_uris).toEqual([redirectUri]);
  expect(reg.token_endpoint_auth_method).toBe('none');
  expect(reg.grant_types).toEqual(['authorization_code']);
  expect(reg.response_types).toEqual(['code']);
  expect(reg.scope).toBe('mcp:read mcp:write');
  expect(typeof reg.client_id_issued_at).toBe('number');

  const clientId = reg.client_id as string;

  // 2) Log in as a seeded member.
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  // 3) /oauth/authorize with the registered client_id → consent.
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

  // 4) Approve consent.
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
  expect(code).toBeTruthy();

  // 5) Token exchange.
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
  const bearer = tokenJson.access_token as string;

  // 6) /mcp whoami.
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
});

test('DCR: rejects non-loopback redirect_uri (https)', async ({ request }) => {
  const res = await request.post('/oauth/register', {
    data: { redirect_uris: ['https://example.com/callback'] },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_redirect_uri');
});

test('DCR: rejects 0.0.0.0 as a redirect_uri host', async ({ request }) => {
  const res = await request.post('/oauth/register', {
    data: { redirect_uris: ['http://0.0.0.0/callback'] },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_redirect_uri');
});

test('DCR: rejects unsupported token_endpoint_auth_method', async ({
  request,
}) => {
  const res = await request.post('/oauth/register', {
    data: {
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'client_secret_basic',
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_client_metadata');
});

test('DCR: rate-limits to 5 registrations per IP per hour', async ({
  request,
}) => {
  // Use a unique X-Forwarded-For so we don't collide with the rate-limit
  // bucket of the other tests in this file (which use the default IP).
  const ip = `10.99.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256,
  )}`;
  const headers = { 'X-Forwarded-For': ip };
  const data = { redirect_uris: ['http://127.0.0.1/callback'] };

  for (let i = 0; i < 5; i++) {
    const res = await request.post('/oauth/register', { data, headers });
    expect(res.status()).toBe(200);
  }
  const limited = await request.post('/oauth/register', { data, headers });
  expect(limited.status()).toBe(429);
});
