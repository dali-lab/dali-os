// POST /api/email/send
// Sends a single email. Callers provide the final subject and HTML body directly.
// Template interpolation / lookup happens upstream (release flow, batch sender UI).
//
// Body (JSON): { to: string, subject: string, html: string }
//
// Requires authenticated user.

import { requireAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import { sendEmail } from '~/lib/gmail'
import { checkRateLimit } from '~/lib/rate-limit'

const GMAIL_USER = 'applications@dali.dartmouth.edu'

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

async function getGmailRefreshToken(): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { daliEmail: GMAIL_USER },
    select: { googleRefreshToken: true },
  })
  if (!user?.googleRefreshToken) {
    throw new Error('Gmail not authorized. Visit /admin/authorize-gmail first.')
  }
  return user.googleRefreshToken
}

export async function action({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }, auth.user.sub)
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { to, subject, html } = body as { to?: string; subject?: string; html?: string }

  if (!to || !subject || !html) {
    return Response.json({ error: 'to, subject, and html are required' }, { status: 400 })
  }

  try {
    const refreshToken = await getGmailRefreshToken()
    await sendEmail({ refreshToken, to, subject, html })
    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Email send error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
