import { prisma } from '~/lib/db'
import { exchangeGoogleCode } from '~/lib/oauth'

const STATE_COOKIE = '__dali_cal_reconnect_state'

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
  const url = new URL(request.url)
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001'

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const googleError = url.searchParams.get('error')

  const clearCookie = `${STATE_COOKIE}=; Path=/account/reconnect-calendar; Max-Age=0; HttpOnly; SameSite=Lax`

  if (googleError || !code || !state) {
    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': clearCookie,
        Location: '/account/integrations?calendar=error',
      },
    })
  }

  // Validate state
  const cookies = parseCookies(request)
  const rawCookie = cookies[STATE_COOKIE]
  if (!rawCookie) {
    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': clearCookie,
        Location: '/account/integrations?calendar=error',
      },
    })
  }

  let savedState: string
  let userId: string
  try {
    const parsed = JSON.parse(decodeURIComponent(rawCookie))
    savedState = parsed.state
    userId = parsed.userId
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': clearCookie,
        Location: '/account/integrations?calendar=error',
      },
    })
  }

  if (savedState !== state) {
    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': clearCookie,
        Location: '/account/integrations?calendar=error',
      },
    })
  }

  // Exchange code for tokens
  try {
    const googleUser = await exchangeGoogleCode(code, `${apiBase}/account/reconnect-calendar/callback`)

    const tokenExpiresAt = googleUser.expiresIn
      ? new Date(Date.now() + googleUser.expiresIn * 1000)
      : null

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(googleUser.accessToken ? { googleAccessToken: googleUser.accessToken } : {}),
        ...(googleUser.refreshToken ? { googleRefreshToken: googleUser.refreshToken } : {}),
        ...(tokenExpiresAt ? { googleTokenExpiresAt: tokenExpiresAt } : {}),
      },
    })
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': clearCookie,
        Location: '/account/integrations?calendar=error',
      },
    })
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': clearCookie,
      Location: '/account/integrations?calendar=connected',
    },
  })
}
