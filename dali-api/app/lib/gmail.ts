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

// ── Email templates ────────────────────────────────────────────────────────

const frontendUrl = () => process.env.FRONTEND_URL ?? 'http://localhost:5173'
const apiBase = () => process.env.API_BASE_URL ?? 'http://localhost:3001'

export function applicationReceivedEmail(firstName: string) {
  return {
    subject: 'We received your DALI application!',
    html: `
      <p>Hi ${firstName},</p>
      <p>Thank you for applying to DALI! We've received your application and our team will review it shortly.</p>
      <p>We'll be in touch with next steps.</p>
      <br/>
      <p>— The DALI Team</p>
    `,
  }
}

export function applicationStatusEmail(firstName: string) {
  return {
    subject: 'Update on your DALI application',
    html: `
      <p>Hi ${firstName},</p>
      <p>There's been an update on your DALI application. Please log in to your application portal to view your status.</p>
      <p><a href="${frontendUrl()}">View your application →</a></p>
      <br/>
      <p>— The DALI Team</p>
    `,
  }
}

export function interviewInviteApplicantEmail(
  firstName: string,
  date: string,
  time: string,
  location: string,
) {
  return {
    subject: 'DALI Interview Invitation',
    html: `
      <p>Hi ${firstName},</p>
      <p>Congratulations — you've been selected for an interview with DALI!</p>
      <p><strong>Date:</strong> ${date}<br/>
      <strong>Time:</strong> ${time}<br/>
      <strong>Location:</strong> ${location}</p>
      <p>Please confirm your availability by logging into your portal.</p>
      <p><a href="${frontendUrl()}">View interview details →</a></p>
      <br/>
      <p>— The DALI Team</p>
    `,
  }
}

export function interviewInviteReviewerEmail(
  firstName: string,
  applicantName: string,
  date: string,
  time: string,
  location: string,
) {
  return {
    subject: `Interview assigned: ${applicantName}`,
    html: `
      <p>Hi ${firstName},</p>
      <p>You've been assigned to interview <strong>${applicantName}</strong>.</p>
      <p><strong>Date:</strong> ${date}<br/>
      <strong>Time:</strong> ${time}<br/>
      <strong>Location:</strong> ${location}</p>
      <p><a href="${apiBase()}/admin">View in admin dashboard →</a></p>
      <br/>
      <p>— The DALI Team</p>
    `,
  }
}

export function applicationAssignedEmail(firstName: string, applicantName: string) {
  return {
    subject: `Application assigned for review: ${applicantName}`,
    html: `
      <p>Hi ${firstName},</p>
      <p>You've been assigned to review <strong>${applicantName}</strong>'s DALI application.</p>
      <p><a href="${apiBase()}/mentor">View in reviewer dashboard →</a></p>
      <br/>
      <p>— The DALI Team</p>
    `,
  }
}
