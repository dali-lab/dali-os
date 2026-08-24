// POST /api/email/send
// Sends a single email. Callers provide the final subject and HTML body directly.
// Template interpolation / lookup happens upstream (release flow, batch sender UI).
//
// Body (JSON): { to: string, subject: string, html: string }
//
// Requires authenticated user.

import { requireAuth } from "~/lib/auth";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { logAuditEvent } from '~/lib/audit'
import { checkRateLimit } from '~/lib/rate-limit'

const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW_MS = 60_000

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
    // Onto the outbox (sends as the applications/Hiring identity, resolved at
    // drain). No dedupKey — this is arbitrary user-composed mail and a legit
    // resend of the same subject must go through; the outbox adds retry, a
    // per-sender daily cap, and an audit trail (Admin → Communications).
    // drainNow attempts it inline so the common case still sends in-request.
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: "Hiring",
      target: to,
      subject,
      bodyHtml: html,
      eventType: "email.send",
      createdByUserId: auth.user.sub,
    })
    await drainNow([id])
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
