// POST /api/email/send
//
// ⚠️  CURRENTLY UNUSED — kept intentionally.
//
// No client posts to this route today. It is preserved for a future ad-hoc
// "send custom email to applicant" admin tool (e.g. requesting a corrected
// portfolio link, one-off correspondence outside the cycle template flow).
// All other email goes through purpose-specific routes that look up a
// CycleNotificationEmail / CycleDecisionEmail binding before calling
// sendEmail directly — see app/lib/gmail.ts for the chokepoint and
// app/hiring/routes/api.decisions.$id.release.ts /
// app/routes/portal.apply.tsx for the binding pattern.
//
// If this is still unused after the next hiring cycle, delete it (and the
// ratelimit + audit-log scaffolding here) rather than letting it bitrot.
//
// Sends a single email. Callers provide the final subject and HTML body
// directly — no template interpolation here.
//
// Body (JSON): { to: string, subject: string, html: string }
//
// Requires authenticated user.

import { requireAuth, withAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import { sendEmail } from '~/lib/gmail'
import { logAuditEvent } from '~/lib/audit'
import { checkRateLimit } from '~/lib/rate-limit'

const GMAIL_USER = 'applications@dali.dartmouth.edu'

const RATE_LIMIT_MAX = 100
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
  if (!auth.ok) return withAuth(auth, Response.json({ error: 'Unauthorized' }, { status: 401 }))

  const limited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }, auth.user.sub)
  if (limited) return withAuth(auth, limited)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return withAuth(auth, Response.json({ error: 'Invalid JSON body' }, { status: 400 }))
  }

  const { to, subject, html } = body as { to?: string; subject?: string; html?: string }

  if (!to || !subject || !html) {
    return withAuth(auth, Response.json({ error: 'to, subject, and html are required' }, { status: 400 }))
  }

  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    return withAuth(auth, Response.json({ error: 'to and subject must not contain line breaks' }, { status: 400 }))
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return withAuth(auth, Response.json({ error: 'Invalid recipient email' }, { status: 400 }))
  }

  try {
    const refreshToken = await getGmailRefreshToken()
    await sendEmail({ refreshToken, to, subject, html })
    await logAuditEvent({
      action: 'email.send',
      userId: auth.user.sub,
      metadata: { to, subject },
      request,
    })
    return withAuth(auth, Response.json({ ok: true }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Email send error:', message)
    return withAuth(auth, Response.json({ error: message }, { status: 500 }))
  }
}
