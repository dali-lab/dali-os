import { redirect } from 'react-router'
import { requireAuth } from '~/lib/auth'
import { requireMember } from '~/lib/roles'
import { randomBytes } from 'node:crypto'

const STATE_COOKIE = '__dali_cal_reconnect_state'

export async function action({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const member = await requireMember(auth.user.sub)
  if (!member) return redirect('/account')

  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001'
  const state = randomBytes(32).toString('base64url')

  // Store state + userId in a cookie for the callback to validate
  const cookieValue = JSON.stringify({ state, userId: auth.user.sub })
  const cookie = `${STATE_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/account/reconnect-calendar; Max-Age=600; HttpOnly; SameSite=Lax`

  const googleParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${apiBase}/account/reconnect-calendar/callback`,
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookie,
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${googleParams}`,
    },
  })
}
