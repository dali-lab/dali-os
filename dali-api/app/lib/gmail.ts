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

  // multipart/mixed
  //   ├─ multipart/alternative
  //   │    └─ text/html
  //   └─ text/calendar; method=…  (Content-Disposition: attachment)
  //
  // A flat multipart/alternative with text/html + text/calendar gets
  // rewritten by Gmail's users.messages.send endpoint, which discards the
  // calendar alternative. Nesting under multipart/mixed forces Gmail to
  // treat the calendar as a real attachment and preserve it through send,
  // which is also what makes the inline RSVP card appear in the inbox.
  const ts = Date.now()
  const outer = `----=_Outer_${ts}`
  const inner = `----=_Inner_${ts}`

  const msg = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    '',
    `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    '',
    `--${inner}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '',
    `--${inner}--`,
    '',
    `--${outer}`,
    `Content-Type: text/calendar; charset=utf-8; method=${method}; name="invite.ics"`,
    'Content-Disposition: attachment; filename="invite.ics"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(ics).toString('base64')),
    '',
    `--${outer}--`,
  ].join('\r\n')
  return Buffer.from(msg).toString('base64url')
}

function stagingBanner(originalTo: string): string {
  return `<div style="background:#fff3cd;border:1px solid #ffeeba;padding:12px;margin-bottom:12px;font-family:sans-serif;color:#856404;">[STAGING] This email would have been sent to <code>${originalTo}</code></div><hr/>`
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
  let actualHtml = html
  if (env === 'staging') {
    actualTo = STAGING_REDIRECT
    actualHtml = stagingBanner(to) + html
  }

  const accessToken = await getAccessToken(refreshToken)
  const raw = makeRawEmail(actualTo, subject, actualHtml, ics)

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
