import { redirect } from 'react-router'
import type { Route } from './+types/email-templates.$id'
import { prisma } from '~/lib/db'
import { requireAuth, withAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { EmailTemplateDetail } from '~/components/EmailTemplateDetail'

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.template?.name
  return [{ title: `${name || 'Email template'} · DALI OS` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const template = await prisma.emailTemplate.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'desc' },
      },
    },
  })

  return withAuth(auth, { template })
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  })
  if (!member) return withAuth(auth, redirect('/login'))

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create-version') {
    const subject = (formData.get('subject') as string)?.trim()
    const body = (formData.get('body') as string) ?? ''
    if (!subject) return withAuth(auth, { error: 'Subject is required' })

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
        createdById: member.id,
      },
    })

    return withAuth(auth, redirect(`/emails/${params.id}`))
  }

  if (intent === 'rename') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return withAuth(auth, { error: 'Name is required' })
    await prisma.emailTemplate.update({
      where: { id: params.id },
      data: { name },
    })
    return withAuth(auth, redirect(`/emails/${params.id}`))
  }

  return withAuth(auth, null)
}

export default EmailTemplateDetail
