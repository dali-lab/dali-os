// GET /admin/authorize-gmail/callback
// Receives the Google OAuth callback, exchanges the code for tokens, and
// stores the refresh token on the purpose's GmailIntegration row. The
// purpose rides the OAuth state (nonce.purpose, CSRF-pinned by cookie); the
// authorized mailbox comes from the id_token, so sendAsEmail always reflects
// the account the admin actually picked.

import { requireAuth } from "~/lib/auth";
import { isCore } from '~/lib/roles'
import { prisma } from '~/lib/db'
import { getApiBaseUrl } from '~/lib/app-env'
import { exchangeGoogleCode, GoogleOAuthError } from '~/lib/google-oauth'
import { EMAIL_PURPOSES, isEmailPurpose, type EmailPurposeKey } from '~/lib/email-identities'

const GMAIL_STATE_COOKIE = '__dali_gmail_oauth_state'

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') ?? ''
  const entries: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [k, ...rest] = part.split('=')
    if (k) entries[k.trim()] = rest.join('=').trim()
  }
  return entries
}

// The id_token arrives straight from Google's token endpoint over TLS in the
// code exchange, so decoding without signature verification is safe here.
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'),
    )
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

// All purposes land back on the Email Senders page, where the connect
// buttons live.
function landing(_purpose: EmailPurposeKey): string {
  return '/admin/email-senders'
}

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) {
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await isCore(auth.user.sub))) {
    return new Response(null, { status: 302, headers: { Location: '/' } })
  }

  const url = new URL(request.url)
  const apiBase = getApiBaseUrl()
  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const clearCookie = `${GMAIL_STATE_COOKIE}=; Path=/admin/authorize-gmail; Max-Age=0; HttpOnly; SameSite=Lax`
  const fail = (target: string, code: string) =>
    new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': clearCookie, Location: `${target}?gmail_error=${code}` },
    })

  // Purpose is recoverable from the returned state even on error paths.
  const statePurpose = state?.split('.')[1]
  const purpose: EmailPurposeKey = isEmailPurpose(statePurpose) ? statePurpose : 'Hiring'
  const target = landing(purpose)

  if (error || !code || !state) {
    return fail(target, 'auth_failed')
  }

  // CSRF check
  const cookies = parseCookies(request)
  if (cookies[GMAIL_STATE_COOKIE] !== state) {
    return fail(target, 'state_mismatch')
  }

  // Exchange code for tokens
  let tokens
  try {
    tokens = await exchangeGoogleCode({
      code,
      redirectUri: `${apiBase}/admin/authorize-gmail/callback`,
      clientId,
      clientSecret,
    })
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      console.error('Gmail token exchange failed:', err.upstreamBody ?? err.message)
      return fail(target, 'token_exchange_failed')
    }
    throw err
  }

  const refreshToken = tokens.refresh_token as string | undefined
  if (!refreshToken) {
    return fail(target, 'no_refresh_token')
  }

  const sendAsEmail = emailFromIdToken(tokens.id_token)
  if (!sendAsEmail) {
    return fail(target, 'no_account_email')
  }

  // Service User row keyed by the authorized mailbox (same pattern the
  // applications@ integration has always used).
  const user = await prisma.user.upsert({
    where: { daliEmail: sendAsEmail },
    update: {},
    create: {
      daliEmail: sendAsEmail,
      firstName: 'DALI',
      lastName: EMAIL_PURPOSES[purpose].label,
    },
    select: { id: true },
  })

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await prisma.gmailIntegration.upsert({
    where: { userId_purpose: { userId: user.id, purpose } },
    update: {
      sendAsEmail,
      oauthTokens: refreshToken,
      tokenExpiresAt,
      enabled: true,
      syncError: null,
    },
    create: {
      userId: user.id,
      purpose,
      sendAsEmail,
      oauthTokens: refreshToken,
      tokenExpiresAt,
      enabled: true,
    },
  })

  return new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': clearCookie, Location: `${target}?gmail_authorized=1` },
    })
}
