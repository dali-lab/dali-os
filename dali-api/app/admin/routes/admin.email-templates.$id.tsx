// Admin → Email Templates → detail: versions of one shared template.
// Moved from /hiring/emails/:id (templates serve every area, not just
// hiring); the old URL redirects here.

import { redirect } from 'react-router'
import type { Route } from './+types/admin.email-templates.$id'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { redirectToLogin } from '~/lib/login-next'
import { isCore } from '~/lib/roles'
import { EmailTemplateDetail } from '~/admin/components/EmailTemplateDetail'
import { regroupRedirect } from "~/core/lib/regroup-redirect.server"
import { driveFolderCrumbs } from '~/lib/drive-crumbs.server'
import { driveRootCrumbs } from '~/lib/drive-crumbs'
import { PageIcon } from '~/components/PageIcon'
import { renderEmail } from '~/lib/email'
import { sendEmail } from '~/lib/gmail'
import { getApplicationsGmailRefreshToken } from '~/lib/gmail-integration'

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.template?.name
  return [{ title: `${name || 'Email template'} · Admin · DALI OS` }]
}

export const handle = {
  breadcrumbTrail: (data: unknown) => {
    const d = data as {
      template?: { name: string }
      driveCrumbs?: { scope: string; folders: { id: string; title: string; iconEmoji: string | null }[] } | null
    } | undefined
    const name = d?.template?.name
    if (!name) return null
    const scope = d?.driveCrumbs?.scope ?? 'core'
    return [
      ...driveRootCrumbs(scope),
      ...(d?.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || 'Untitled folder',
        to: `/drive?scope=${scope}&folder=${f.id}`,
        icon: <PageIcon iconEmoji={f.iconEmoji} />,
      })),
      { label: name },
    ]
  },
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirectToLogin(request)
  const regrouped = await regroupRedirect(
    request,
    auth.user.sub,
    "/admin/email-templates",
    "/core/communications/email",
  )
  if (regrouped) return regrouped
  if (!(await isCore(auth.user.sub))) return redirect('/')

  const template = await prisma.emailTemplate.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'desc' },
      },
    },
  })

  const driveCrumbs = await driveFolderCrumbs(template.folderPageId, auth.user.sub, request)

  return { template, driveCrumbs }
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirectToLogin(request)
  if (!(await isCore(auth.user.sub))) return redirect('/')

  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
  })
  if (!member) return redirectToLogin(request)

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create-version') {
    const subject = (formData.get('subject') as string)?.trim()
    const body = (formData.get('body') as string) ?? ''
    if (!subject) return { error: 'Subject is required' }

    const lastVersion = await prisma.emailTemplateVersion.findFirst({
      where: { templateId: params.id },
      orderBy: { versionNumber: 'desc' },
    })
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1

    await prisma.emailTemplateVersion.create({
      data: {
        templateId: params.id,
        versionNumber,
        subject,
        body,
        createdById: auth.user.sub,
      },
    })

    return redirect(`/admin/email-templates/${params.id}`)
  }

  if (intent === 'rename') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return { error: 'Name is required' }
    await prisma.emailTemplate.update({
      where: { id: params.id },
      data: { name },
    })
    return redirect(`/admin/email-templates/${params.id}`)
  }

  if (intent === 'send-test') {
    const subject = (formData.get('subject') as string)?.trim()
    const body = (formData.get('body') as string) ?? ''
    if (!subject) return { error: 'No version selected to send.' }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { firstName: true, daliEmail: true },
    })
    const toEmail = user?.daliEmail
    if (!toEmail) return { error: 'Your account has no DALI email address on file.' }

    // Render with sample values so the tester sees realistic output.
    const sampleVars = {
      firstName: user.firstName || 'FirstName',
      domain: 'Product Design',
      time: 'Friday, Jan 10 at 2:00 PM',
      location: 'MacLean 132',
      meetingUrl: 'https://dartmouth.zoom.us/j/example',
      originalCloseDate: 'January 7',
      newCloseDate: 'January 14',
    }
    const { subject: renderedSubject, html } = renderEmail({ subject, body }, sampleVars)

    const refreshToken = await getApplicationsGmailRefreshToken()
    if (!refreshToken) return { error: 'Gmail integration not configured.' }

    await sendEmail({ refreshToken, to: toEmail, subject: renderedSubject, html })
    return { testSent: true as const }
  }

  return null
}

export default EmailTemplateDetail
