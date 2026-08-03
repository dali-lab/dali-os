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

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.template?.name
  return [{ title: `${name || 'Email template'} · Admin · DALI OS` }]
}

export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { template?: { name: string } } | undefined)?.template?.name,
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirectToLogin(request)
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

  return { template }
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

  return null
}

export default EmailTemplateDetail
