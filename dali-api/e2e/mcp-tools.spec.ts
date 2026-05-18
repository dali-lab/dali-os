import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from './fixtures';

// E2E coverage for the Tier 1 MCP read tools. Walks the existing OAuth flow
// (registered client → /oauth/authorize → consent → token) once, then calls
// every new tool over /mcp asserting response shape only (no data asserts).

function base64UrlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

async function obtainBearer({
  request,
  page,
  loginAs,
}: {
  request: import('@playwright/test').APIRequestContext;
  page: import('@playwright/test').Page;
  loginAs: (opts: { daliEmail?: string; netId?: string }) => Promise<void>;
}): Promise<string> {
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const redirectUri = 'http://127.0.0.1:51999/callback';
  const regIp = `10.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256,
  )}.${Math.floor(Math.random() * 256)}`;
  const regRes = await request.post('/oauth/register', {
    headers: { 'X-Forwarded-For': regIp },
    data: { redirect_uris: [redirectUri], client_name: 'Claude Code E2E' },
  });
  expect(regRes.status()).toBe(200);
  const clientId = (await regRes.json()).client_id as string;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = base64UrlSha256(verifier);
  const state = randomBytes(8).toString('hex');

  await page.goto(
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
      }),
  );
  await expect(page).toHaveURL(/\/oauth\/consent\?session_id=/);

  const sessionIdMatch = page.url().match(/session_id=([^&]+)/);
  const oauthSessionId = sessionIdMatch![1];

  const consentResponse = await page.request.post('/oauth/consent', {
    form: { session_id: oauthSessionId, decision: 'approve' },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const loc = consentResponse.headers()['location'];
  const callbackUrl = new URL(loc);
  const code = callbackUrl.searchParams.get('code')!;

  const tokenRes = await request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    },
  });
  return (await tokenRes.json()).access_token as string;
}

async function callTool(
  request: import('@playwright/test').APIRequestContext,
  bearer: string,
  name: string,
  args: Record<string, unknown>,
) {
  const res = await request.post('/mcp', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1_000_000),
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe('MCP Tier 1 read tools', () => {
  test('every tier-1 tool returns a well-formed response shape', async ({
    page,
    loginAs,
    request,
  }) => {
    const bearer = await obtainBearer({ request, page, loginAs });

    // tools/list — should list all six tools.
    const listRes = await request.post('/mcp', {
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      data: { jsonrpc: '2.0', id: 0, method: 'tools/list' },
    });
    const listJson = await listRes.json();
    const toolNames = listJson.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'whoami',
        'list_my_notifications',
        'list_my_upcoming_meetings',
        'find_mutual_freebusy',
        'search_directory',
        'get_member_profile',
      ]),
    );

    // list_my_notifications
    const notifs = await callTool(request, bearer, 'list_my_notifications', {});
    expect(notifs.error).toBeUndefined();
    expect(notifs.result.structuredContent).toHaveProperty('unreadCount');
    expect(notifs.result.structuredContent).toHaveProperty('notifications');
    expect(Array.isArray(notifs.result.structuredContent.notifications)).toBe(true);

    // list_my_upcoming_meetings
    const meetings = await callTool(request, bearer, 'list_my_upcoming_meetings', {
      daysAhead: 14,
    });
    expect(meetings.error).toBeUndefined();
    expect(Array.isArray(meetings.result.structuredContent.meetings)).toBe(true);

    // find_mutual_freebusy — caller is implicit; no other participants needed.
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const freebusy = await callTool(request, bearer, 'find_mutual_freebusy', {
      participantUserIds: [],
      windowStart: now.toISOString(),
      windowEnd: tomorrow.toISOString(),
      slotMinutes: 30,
    });
    expect(freebusy.error).toBeUndefined();
    expect(Array.isArray(freebusy.result.structuredContent.slots)).toBe(true);

    // search_directory — query "a" hits most member names.
    const search = await callTool(request, bearer, 'search_directory', {
      query: 'a',
      limit: 5,
    });
    expect(search.error).toBeUndefined();
    expect(Array.isArray(search.result.structuredContent.results)).toBe(true);

    // get_member_profile — call against the caller's own id (via whoami).
    const whoami = await callTool(request, bearer, 'whoami', {});
    const myId = whoami.result.structuredContent.id as string;
    const profile = await callTool(request, bearer, 'get_member_profile', {
      memberId: myId,
    });
    expect(profile.error).toBeUndefined();
    expect(profile.result.structuredContent.id).toBe(myId);
    // Self-profile path: personalEmail should be present (could be null if
    // unset, but the key must exist).
    expect(profile.result.structuredContent).toHaveProperty('personalEmail');
  });

  test('input validation rejects bad arguments', async ({ page, loginAs, request }) => {
    const bearer = await obtainBearer({ request, page, loginAs });
    const res = await request.post('/mcp', {
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'list_my_notifications', arguments: { limit: 9999 } },
      },
    });
    const json = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32602);
  });
});
