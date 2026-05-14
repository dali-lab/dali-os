// GET /admin/authorize-gmail
// Initiates the one-time OAuth flow to authorize the applications@ Gmail account.
// Must be visited while logged in as an admin.
// After Google redirects back, /admin/authorize-gmail/callback stores the refresh token.

import { requireAuth } from "~/lib/auth";
import { isHiringLead } from '~/lib/roles'
import { randomBytes } from 'node:crypto'

const GMAIL_STATE_COOKIE = '__dali_gmail_oauth_state'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'openid',
  'email',
].join(' ')

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) {
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await isHiringLead(auth.user.sub))) {
    return new Response(null, { status: 302, headers: { Location: '/' } })
  }

  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001'
  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!

  const state = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${apiBase}/admin/authorize-gmail/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
    login_hint: 'applications@dali.dartmouth.edu',
  })

  const stateCookie = `${GMAIL_STATE_COOKIE}=${state}; Path=/admin/authorize-gmail; Max-Age=600; HttpOnly; SameSite=Lax`

  return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': stateCookie,
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      },
    })
}
