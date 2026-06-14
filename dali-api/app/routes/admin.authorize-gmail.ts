// GET /admin/authorize-gmail
// Initiates the one-time OAuth flow to authorize the applications@ Gmail account.
// Must be visited while logged in as an admin.
// After Google redirects back, /admin/authorize-gmail/callback stores the refresh token.

import { requireAuth } from "~/lib/auth";
import { isCore } from '~/lib/roles'
import { getApiBaseUrl, APPLICATIONS_FROM_EMAIL } from '~/lib/app-env'
import { buildGoogleAuthUrl } from '~/lib/google-oauth'
import { randomBytes } from 'node:crypto'

const GMAIL_STATE_COOKIE = '__dali_gmail_oauth_state'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'openid',
  'email',
]

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) {
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await isCore(auth.user.sub))) {
    return new Response(null, { status: 302, headers: { Location: '/' } })
  }

  const apiBase = getApiBaseUrl()
  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!

  const state = randomBytes(16).toString('hex')
  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri: `${apiBase}/admin/authorize-gmail/callback`,
    scopes: SCOPES,
    state,
    accessType: 'offline',
    prompt: 'consent',
    loginHint: APPLICATIONS_FROM_EMAIL,
  })

  const stateCookie = `${GMAIL_STATE_COOKIE}=${state}; Path=/admin/authorize-gmail; Max-Age=600; HttpOnly; SameSite=Lax`

  return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': stateCookie,
        Location: authUrl,
      },
    })
}
