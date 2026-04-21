// POST /api/email/send
// Triggers sending one of the pre-defined email types to an applicant or reviewer.
// Body (JSON):
//   type: "application_received" | "application_status" | "interview_invite_applicant"
//         | "interview_invite_reviewer" | "application_assigned"
//   ...type-specific fields (see cases below)
//
// Requires admin auth.

import { requireAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import {
  sendEmail,
  applicationReceivedEmail,
  applicationStatusEmail,
  interviewInviteApplicantEmail,
  interviewInviteReviewerEmail,
  applicationAssignedEmail,
} from '~/lib/gmail'

const GMAIL_USER = 'applications@dali.dartmouth.edu'

async function getGmailRefreshToken(): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { user: { email: GMAIL_USER }, providerId: "gmail" },
    select: { refreshToken: true },
  })
  if (!account?.refreshToken) {
    throw new Error('Gmail not authorized. Visit /admin/authorize-gmail first.')
  }
  return account.refreshToken
}

export async function action({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { type } = body

  try {
    const refreshToken = await getGmailRefreshToken()

    switch (type) {
      case 'application_received': {
        const { to, firstName } = body as { to: string; firstName: string }
        const { subject, html } = applicationReceivedEmail(firstName)
        await sendEmail({ refreshToken, to, subject, html })
        break
      }

      case 'application_status': {
        const { to, firstName } = body as { to: string; firstName: string }
        const { subject, html } = applicationStatusEmail(firstName)
        await sendEmail({ refreshToken, to, subject, html })
        break
      }

      case 'interview_invite_applicant': {
        const { to, firstName, date, time, location } = body as {
          to: string
          firstName: string
          date: string
          time: string
          location: string
        }
        const { subject, html } = interviewInviteApplicantEmail(firstName, date, time, location)
        await sendEmail({ refreshToken, to, subject, html })
        break
      }

      case 'interview_invite_reviewer': {
        const { to, firstName, applicantName, date, time, location } = body as {
          to: string
          firstName: string
          applicantName: string
          date: string
          time: string
          location: string
        }
        const { subject, html } = interviewInviteReviewerEmail(
          firstName,
          applicantName,
          date,
          time,
          location,
        )
        await sendEmail({ refreshToken, to, subject, html })
        break
      }

      case 'application_assigned': {
        const { to, firstName, applicantName } = body as {
          to: string
          firstName: string
          applicantName: string
        }
        const { subject, html } = applicationAssignedEmail(firstName, applicantName)
        await sendEmail({ refreshToken, to, subject, html })
        break
      }

      case 'custom': {
        const { to, subject, html } = body as { to: string; subject: string; html: string }
        await sendEmail({ refreshToken, to, subject, html })
        break
      }

      default:
        return Response.json({ error: `Unknown email type: ${type}` }, { status: 400 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Email send error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
