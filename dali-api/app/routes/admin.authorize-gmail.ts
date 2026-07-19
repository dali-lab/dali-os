// GET /admin/authorize-gmail?purpose=Hiring|Education|Partners|General
// Initiates the one-time OAuth flow to authorize a Gmail send-as identity
// for the given purpose (default Hiring — the historical applications@
// integration). Must be visited while logged in as Core.
// After Google redirects back, /admin/authorize-gmail/callback stores the
// refresh token on the purpose's GmailIntegration row.

import { requireAuth } from "~/lib/auth";
import { isCore } from '~/lib/roles'
import { getApiBaseUrl, APPLICATIONS_FROM_EMAIL } from '~/lib/app-env'
import { buildGoogleAuthUrl } from '~/lib/google-oauth'
import { isEmailPurpose, type EmailPurposeKey } from '~/lib/email-identities'
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

  const url = new URL(request.url)
  const purposeParam = url.searchParams.get('purpose') ?? 'Hiring'
  const purpose: EmailPurposeKey = isEmailPurpose(purposeParam) ? purposeParam : 'Hiring'

  const apiBase = getApiBaseUrl()
  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!

  // The purpose rides the state (nonce.purpose) so the callback knows which
  // integration row to write; the cookie pins the whole value for CSRF.
  const state = `${randomBytes(16).toString('hex')}.${purpose}`
  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri: `${apiBase}/admin/authorize-gmail/callback`,
    scopes: SCOPES,
    state,
    accessType: 'offline',
    prompt: 'consent',
    // Only the Hiring identity has a fixed, known mailbox. Other purposes
    // land on Google's account chooser.
    loginHint: purpose === 'Hiring' ? APPLICATIONS_FROM_EMAIL : undefined,
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
