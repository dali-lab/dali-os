// Gmail sending via OAuth refresh token stored on the applications@ user row.
// All outbound email comes from applications@dali.dartmouth.edu.

const GMAIL_USER = 'applications@dali.dartmouth.edu'
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

function makeRawEmail(to: string, subject: string, htmlBody: string): string {
  const msg = [
    `From: DALI Lab <${GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\r\n')
  return Buffer.from(msg).toString('base64url')
}

export async function sendEmail({
  refreshToken,
  to,
  subject,
  html,
}: {
  refreshToken: string
  to: string
  subject: string
  html: string
}) {
  const accessToken = await getAccessToken(refreshToken)
  const raw = makeRawEmail(to, subject, html)

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

