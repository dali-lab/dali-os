// POST /api/email/send
// Sends a single email. Callers provide the final subject and HTML body directly.
// Template interpolation / lookup happens upstream (release flow, batch sender UI).
//
// Body (JSON): { to: string, subject: string, html: string }
//
// Requires authenticated user.

import { requireAuth } from "~/lib/auth";
import { sendEmail } from '~/lib/gmail'
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { logAuditEvent } from '~/lib/audit'
import { checkRateLimit } from '~/lib/rate-limit'

const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW_MS = 60_000

async function getGmailRefreshToken(): Promise<string> {
  const token = await getApplicationsGmailRefreshToken();
  if (!token) {
    throw new Error('Gmail not authorized. Visit /admin/authorize-gmail first.')
  }
  return token;
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

  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    return Response.json({ error: 'to and subject must not contain line breaks' }, { status: 400 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return Response.json({ error: 'Invalid recipient email' }, { status: 400 })
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
    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Email send error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
