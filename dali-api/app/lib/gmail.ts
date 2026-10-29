// Gmail sending via a purpose-keyed OAuth refresh token. The token authenticates
// as one Gmail account (the purpose's send-as identity), so every request targets
// the `me` mailbox and stamps `From:` with that identity — a token for account A
// sending against account B's mailbox is rejected by Gmail. Callers that don't
// pass `from` default to the applications@ identity (the historical sender).

import {
  getAppEnv,
  APPLICATIONS_FROM_EMAIL as GMAIL_USER,
  APPLICATIONS_FROM_NAME,
  STAGING_REDIRECT_EMAIL as STAGING_REDIRECT,
} from './app-env'
import { refreshGoogleToken } from '~/lib/google-oauth'
import { htmlToPlainText } from '~/lib/email'

const CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!

export async function getGmailAccessToken(refreshToken: string): Promise<string> {
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

function base64Body(s: string): string {
  return wrapBase64(Buffer.from(s, 'utf8').toString('base64'))
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

// RFC 2047 encoded-words for header values. Raw UTF-8 in a header gets read as
// Latin-1 by Gmail, which turned "🎉" subjects into "Ã°ÂŸÂŽÂ‰". Chunks are cut
// on code-point boundaries (45 bytes → 60 base64 chars) so each word stays
// under the 75-char limit without splitting a multi-byte character.
export function encodeHeader(value: string): string {
  const clean = sanitizeHeader(value)
  if (PRINTABLE_ASCII.test(clean)) return clean
  const words: string[] = []
  let chunk = ''
  for (const ch of clean) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`)
    .join('\r\n ')
}

function attachmentParams(filename: string): { name: string; disposition: string } {
  const clean = sanitizeHeader(filename).replace(/["\\]/g, '_')
  if (PRINTABLE_ASCII.test(clean)) {
    return { name: `name="${clean}"`, disposition: `filename="${clean}"` }
  }
  return {
    name: `name="${encodeHeader(clean).replace(/\r\n /g, '')}"`,
    disposition: `filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
  }
}

// A generic file attachment (e.g. a signed-agreement PDF). Distinct from the
// `ics` calendar payload, which has its own inline-alternative + attachment
// dance below.
export type EmailAttachment = { filename: string; mimeType: string; content: Buffer }

export function makeRawEmail(
  to: string,
  subject: string,
  htmlBody: string,
  from: string,
  ics?: string,
  attachments?: EmailAttachment[],
  textBody?: string,
): string {
  const headers = [
    `From: ${encodeHeader(APPLICATIONS_FROM_NAME)} <${sanitizeHeader(from)}>`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ]

  // Every message carries a text/plain alternative. Before this, a send with
  // no ics and no attachment emitted a bare text/html part — which was most of
  // them. HTML-only mail is a documented spam signal (SpamAssassin's
  // MIME_HTML_ONLY), unreadable in text-only clients, and leaves screen readers
  // with whatever the HTML happens to linearize to.
  //
  // The envelope is always:
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
  // Caller-supplied text wins: a template can write a better plain-text
  // version than any HTML conversion (sign-in codes, agreement receipts).
  // Uncapped — truncating a text part ends the message mid-sentence.
  const plainText = textBody?.trim() ? textBody : htmlToPlainText(htmlBody)

  const lines: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    '',
    `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    '',
    `--${inner}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(plainText),
    '',
    `--${inner}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(htmlBody),
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
    const params = attachmentParams(att.filename)
    lines.push(
      `--${outer}`,
      `Content-Type: ${sanitizeHeader(att.mimeType)}; ${params.name}`,
      `Content-Disposition: attachment; ${params.disposition}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(att.content.toString('base64')),
      '',
    )
  }

  lines.push(`--${outer}--`)
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

// The non-prod warning, injected AFTER the opening <body> tag rather than
// prepended to the string. Prepending was safe while every caller passed a bare
// fragment, but the shared layout emits a full document, and a <div> before
// <!DOCTYPE html> puts the client into quirks mode or gets stripped outright.
// Falls back to prepending only when there is no <body> to inject into.
function injectStagingBanner(html: string, originalTo: string): string {
  const banner = `<div style="background:#fff3cd;border:1px solid #ffeeba;padding:12px;font-family:sans-serif;color:#856404;">[STAGING] This email would have been sent to <code>${originalTo}</code></div>`
  const bodyOpen = html.match(/<body\b[^>]*>/i)
  if (!bodyOpen) return banner + '<hr/>' + html
  const at = (bodyOpen.index ?? 0) + bodyOpen[0].length
  return html.slice(0, at) + banner + html.slice(at)
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
  text,
  ics,
  attachments,
  from = GMAIL_USER,
}: {
  refreshToken: string
  to: string
  subject: string
  html: string
  // Plain-text alternative. Omitted → derived from `html`. Supplying it lets a
  // template write real prose instead of a flattened conversion.
  text?: string
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
    actualHtml = injectStagingBanner(html, to)
    if (actualIcs) {
      actualIcs = injectStagingAttendee(actualIcs, STAGING_REDIRECT)
      actualIcs = prefixIcsSummary(actualIcs, '[STAGING] ')
    }
  }

  const accessToken = await getGmailAccessToken(refreshToken)
  const actualText =
    text && env === 'staging' ? `[STAGING] would have gone to ${to}\n\n${text}` : text
  const raw = makeRawEmail(
    actualTo,
    actualSubject,
    actualHtml,
    from,
    actualIcs,
    attachments,
    actualText,
  )

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
