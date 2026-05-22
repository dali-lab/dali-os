// Gmail sending via OAuth refresh token stored on the applications@ user row.
// All outbound email comes from applications@dali.dartmouth.edu.

import { getAppEnv } from './app-env'

const GMAIL_USER = 'applications@dali.dartmouth.edu'
const STAGING_REDIRECT = 'systems@dali.dartmouth.edu'
const CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Failed to refresh Gmail token: ${await res.text()}`)
  const data = await res.json()
  return data.access_token as string
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, '')
}

function wrapBase64(s: string, width = 76): string {
  return s.match(new RegExp(`.{1,${width}}`, 'g'))?.join('\r\n') ?? s
}

// Minimal HTML → plain text. Good enough for a text/plain alternative;
// Gmail rarely shows it but standards-compliant clients fall back to it
// and some heuristics in mail providers prefer messages that include it.
function htmlToPlainText(html: string): string {
  // Replace block-level closers/breaks with newlines BEFORE stripping tags
  // so paragraph structure survives.
  let text = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')

  // Strip tags in a loop until stable. A single `<[^>]+>` pass on
  // `<scr<script>ipt>` would leave `<script>` behind; iterating prevents
  // that smuggling pattern.
  let prev: string
  do {
    prev = text
    text = prev.replace(/<[^>]+>/g, '')
  } while (text !== prev)

  // Decode only entities that can't reintroduce angle brackets into the
  // output (`&lt;` / `&gt;` deliberately left encoded so a tag-strip-then-
  // decode sequence can't smuggle script-like content back into the body).
  // `&amp;` is decoded LAST so `&amp;nbsp;` lands as `&nbsp;` rather than
  // double-unescaping into a space.
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function makeRawEmail(to: string, subject: string, htmlBody: string, ics?: string): string {
  const headers = [
    `From: DALI Lab <${GMAIL_USER}>`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
  ]

  if (!ics) {
    const msg = [
      ...headers,
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ].join('\r\n')
    return Buffer.from(msg).toString('base64url')
  }

  // Extract METHOD from the ICS content (e.g. REQUEST or CANCEL)
  const methodMatch = ics.match(/METHOD:(\w+)/)
  const method = methodMatch?.[1] ?? 'REQUEST'

  // Calendar invite MIME — mirrors the structure Google Calendar itself
  // emits, which is what triggers Gmail's inline RSVP card on the receiving
  // side:
  //
  //   multipart/mixed
  //     ├─ multipart/alternative
  //     │    ├─ text/plain
  //     │    ├─ text/html
  //     │    └─ text/calendar; method=REQUEST   (INLINE — Gmail reads this
  //     │                                         to render Yes / Maybe / No
  //     │                                         and add-to-calendar)
  //     └─ application/ics; name=invite.ics      (separate attachment for
  //                                                Outlook / Apple Mail —
  //                                                application/ics, not
  //                                                text/calendar, so Gmail
  //                                                doesn't dedupe and drop
  //                                                the inline part)
  //
  // The prior approach (only text/calendar as an attachment under
  // multipart/mixed) preserved the ICS through Gmail's send-API rewriting
  // but did NOT trigger the inline RSVP card — Gmail only renders that
  // when text/calendar sits inside multipart/alternative as a body
  // alternative.
  const ts = Date.now()
  const outer = `----=_Outer_${ts}`
  const inner = `----=_Inner_${ts}`
  const icsBase64 = wrapBase64(Buffer.from(ics).toString('base64'))
  const plainText = htmlToPlainText(htmlBody)

  const msg = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    '',
    `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    '',
    `--${inner}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    plainText,
    '',
    `--${inner}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '',
    `--${inner}`,
    `Content-Type: text/calendar; charset=utf-8; method=${method}`,
    'Content-Transfer-Encoding: base64',
    '',
    icsBase64,
    '',
    `--${inner}--`,
    '',
    `--${outer}`,
    'Content-Type: application/ics; name="invite.ics"',
    'Content-Disposition: attachment; filename="invite.ics"',
    'Content-Transfer-Encoding: base64',
    '',
    icsBase64,
    '',
    `--${outer}--`,
  ].join('\r\n')
  return Buffer.from(msg).toString('base64url')
}

function stagingBanner(originalTo: string): string {
  return `<div style="background:#fff3cd;border:1px solid #ffeeba;padding:12px;margin-bottom:12px;font-family:sans-serif;color:#856404;">[STAGING] This email would have been sent to <code>${originalTo}</code></div><hr/>`
}

// Gmail only renders the inline RSVP card when the recipient's email matches
// an ATTENDEE in the ICS. In staging we rewrite the To: header to
// STAGING_REDIRECT, but the ICS still carries the real attendees — so Gmail
// sees no match and falls back to "just an attachment." Inject an extra
// ATTENDEE line for the redirect inbox so the staging recipient is also a
// recognized attendee. ICS in prod is never touched.
function injectStagingAttendee(ics: string, email: string): string {
  const line = `ATTENDEE;CN=Staging Redirect;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${email}`
  // ICS uses CRLF per RFC 5545. Preserve it by matching with \r\n.
  return ics.replace(/END:VEVENT/i, `${line}\r\nEND:VEVENT`)
}

// Mark the event title (SUMMARY) with a [STAGING] tag so the Google Calendar
// view of a staging-redirected invite is visually distinct from a real one.
function prefixIcsSummary(ics: string, prefix: string): string {
  // ^ with /m matches start-of-line after \n (CRLF-safe). Prefixes the first
  // SUMMARY line in the VEVENT.
  return ics.replace(/^SUMMARY:/m, `SUMMARY:${prefix}`)
}

export async function sendEmail({
  refreshToken,
  to,
  subject,
  html,
  ics,
}: {
  refreshToken: string
  to: string
  subject: string
  html: string
  ics?: string
}) {
  const env = getAppEnv()

  if (env === 'dev') {
    console.info(`[email:dev] skipped send to=${to} subject=${JSON.stringify(subject)}`)
    return { skipped: true as const, env }
  }

  let actualTo = to
  let actualSubject = subject
  let actualHtml = html
  let actualIcs = ics
  if (env === 'staging') {
    actualTo = STAGING_REDIRECT
    actualSubject = `[STAGING] ${subject}`
    actualHtml = stagingBanner(to) + html
    if (actualIcs) {
      actualIcs = injectStagingAttendee(actualIcs, STAGING_REDIRECT)
      actualIcs = prefixIcsSummary(actualIcs, '[STAGING] ')
    }
  }

  const accessToken = await getAccessToken(refreshToken)
  const raw = makeRawEmail(actualTo, actualSubject, actualHtml, actualIcs)

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    },
  )
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`)
  return res.json()
}
