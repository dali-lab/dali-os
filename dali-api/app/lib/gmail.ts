// Gmail sending via a purpose-keyed OAuth refresh token. The token authenticates
// as one Gmail account (the purpose's send-as identity), so every request targets
// the `me` mailbox and stamps `From:` with that identity — a token for account A
// sending against account B's mailbox is rejected by Gmail. Callers that don't
// pass `from` default to the applications@ identity (the historical sender).

import { getAppEnv, APPLICATIONS_FROM_EMAIL as GMAIL_USER, APPLICATIONS_FROM_NAME } from './app-env'
import { refreshGoogleToken } from '~/lib/google-oauth'

const STAGING_REDIRECT = 'systems@dali.dartmouth.edu'
const CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!

async function getAccessToken(refreshToken: string): Promise<string> {
  const tokens = await refreshGoogleToken({
    refreshToken,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  })
  return tokens.access_token
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

// A generic file attachment (e.g. a signed-agreement PDF). Distinct from the
// `ics` calendar payload, which has its own inline-alternative + attachment
// dance below.
export type EmailAttachment = { filename: string; mimeType: string; content: Buffer }

function makeRawEmail(
  to: string,
  subject: string,
  htmlBody: string,
  from: string,
  ics?: string,
  attachments?: EmailAttachment[],
): string {
  const headers = [
    `From: ${APPLICATIONS_FROM_NAME} <${sanitizeHeader(from)}>`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
  ]

  const hasAttachments = !!attachments && attachments.length > 0
  if (!ics && !hasAttachments) {
    const msg = [
      ...headers,
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ].join('\r\n')
    return Buffer.from(msg).toString('base64url')
  }

  // Anything richer than a bare HTML body is a multipart/mixed envelope:
  //
  //   multipart/mixed
  //     ├─ multipart/alternative
  //     │    ├─ text/plain
  //     │    ├─ text/html
  //     │    └─ text/calendar; method=REQUEST   (ics only — INLINE, so Gmail
  //     │                                         renders the RSVP card)
  //     ├─ application/ics; name=invite.ics      (ics only — separate part for
  //     │                                          Outlook / Apple Mail)
  //     └─ <mimeType>; name="file.pdf"           (each generic attachment)
  //
  // Calendar invites mirror the structure Google Calendar itself emits, which
  // is what triggers Gmail's inline RSVP card: text/calendar has to sit inside
  // multipart/alternative as a body alternative, with a second application/ics
  // part so non-Gmail clients still get a real attachment.
  const ts = Date.now()
  const outer = `----=_Outer_${ts}`
  const inner = `----=_Inner_${ts}`
  const plainText = htmlToPlainText(htmlBody)

  const lines: string[] = [
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
  ]

  let icsBase64 = ''
  if (ics) {
    const method = ics.match(/METHOD:(\w+)/)?.[1] ?? 'REQUEST'
    icsBase64 = wrapBase64(Buffer.from(ics).toString('base64'))
    lines.push(
      `--${inner}`,
      `Content-Type: text/calendar; charset=utf-8; method=${method}`,
      'Content-Transfer-Encoding: base64',
      '',
      icsBase64,
      '',
    )
  }
  lines.push(`--${inner}--`, '')

  if (ics) {
    lines.push(
      `--${outer}`,
      'Content-Type: application/ics; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      'Content-Transfer-Encoding: base64',
      '',
      icsBase64,
      '',
    )
  }

  for (const att of attachments ?? []) {
    const filename = sanitizeHeader(att.filename)
    lines.push(
      `--${outer}`,
      `Content-Type: ${sanitizeHeader(att.mimeType)}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(att.content.toString('base64')),
      '',
    )
  }

  lines.push(`--${outer}--`)
  return Buffer.from(lines.join('\r\n')).toString('base64url')
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
  attachments,
  from = GMAIL_USER,
}: {
  refreshToken: string
  to: string
  subject: string
  html: string
  ics?: string
  // Generic file attachments (e.g. a signed-agreement PDF receipt). Independent
  // of `ics`; both may be present.
  attachments?: EmailAttachment[]
  // Send-as identity for the From: header. Must match the account the
  // refreshToken authenticates as, or Gmail rejects the send. Defaults to the
  // applications@ identity for callers that pass its token.
  from?: string
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
  const raw = makeRawEmail(actualTo, actualSubject, actualHtml, from, actualIcs, attachments)

  // `me` = the account the token authenticates as. Using the sender's own
  // mailbox (not a hardcoded address) is what lets non-applications@ senders
  // — General, Education, Partners — actually send.
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
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
