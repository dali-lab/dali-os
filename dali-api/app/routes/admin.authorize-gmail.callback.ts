// GET /admin/authorize-gmail/callback
// Receives the Google OAuth callback, exchanges the code for tokens,
// and stores the refresh token on the applications@dali.dartmouth.edu user row.

import { requireAuth, withAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'

const GMAIL_STATE_COOKIE = '__dali_gmail_oauth_state'
const GMAIL_USER = 'applications@dali.dartmouth.edu'

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') ?? ''
  const entries: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [k, ...rest] = part.split('=')
    if (k) entries[k.trim()] = rest.join('=').trim()
  }
  return entries
}

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) {
    return withAuth(auth, new Response(null, { status: 302, headers: { Location: '/login' } }))
  }

  if (!(await isHiringLead(auth.user.sub))) {
    return withAuth(auth, new Response(null, { status: 302, headers: { Location: '/' } }))
  }

  const url = new URL(request.url)
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001'
  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const clearCookie = `${GMAIL_STATE_COOKIE}=; Path=/admin/authorize-gmail; Max-Age=0; HttpOnly; SameSite=Lax`

  if (error || !code || !state) {
    return withAuth(auth, new Response(null, {
          status: 302,
          headers: { 'Set-Cookie': clearCookie, Location: '/hiring/emails?gmail_error=auth_failed' },
        }))
  }

  // CSRF check
  const cookies = parseCookies(request)
  if (cookies[GMAIL_STATE_COOKIE] !== state) {
    return withAuth(auth, new Response(null, {
          status: 302,
          headers: { 'Set-Cookie': clearCookie, Location: '/hiring/emails?gmail_error=state_mismatch' },
        }))
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${apiBase}/admin/authorize-gmail/callback`,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('Gmail token exchange failed:', await tokenRes.text())
    return withAuth(auth, new Response(null, {
          status: 302,
          headers: { 'Set-Cookie': clearCookie, Location: '/hiring/emails?gmail_error=token_exchange_failed' },
        }))
  }

  const tokens = await tokenRes.json()
  const refreshToken = tokens.refresh_token as string | undefined

  if (!refreshToken) {
    return withAuth(auth, new Response(null, {
          status: 302,
          headers: { 'Set-Cookie': clearCookie, Location: '/hiring/emails?gmail_error=no_refresh_token' },
        }))
  }

  // Store the refresh token on the applications@ user row (upsert in case it doesn't exist yet)
  await prisma.user.upsert({
    where: { daliEmail: GMAIL_USER },
    update: {
      googleRefreshToken: refreshToken,
      googleAccessToken: tokens.access_token ?? null,
      googleTokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
    },
    create: {
      daliEmail: GMAIL_USER,
      firstName: 'DALI',
      lastName: 'Applications',
      googleRefreshToken: refreshToken,
      googleAccessToken: tokens.access_token ?? null,
      googleTokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
    },
  })

  return withAuth(auth, new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': clearCookie, Location: '/hiring/emails?gmail_authorized=1' },
    }))
}
