import { redirect } from 'react-router'
import type { Route } from './+types/email-templates'
import { prisma } from '~/lib/db'
import { requireAuth, withAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import EmailTemplatesList from '~/hiring/components/EmailTemplates'

export const meta: Route.MetaFunction = () => [{ title: 'Email templates · DALI OS' }]

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const [templates, gmailUser] = await Promise.all([
    prisma.emailTemplate.findMany({
      include: {
        versions: {
          include: { createdBy: true },
          orderBy: { versionNumber: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findUnique({
      where: { daliEmail: 'applications@dali.dartmouth.edu' },
      select: { googleRefreshToken: true },
    }),
  ])
  return withAuth(auth, { templates, gmailConnected: !!gmailUser?.googleRefreshToken })
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return withAuth(auth, { error: 'Name is required' })
    const template = await prisma.emailTemplate.create({ data: { name } })
    return withAuth(auth, redirect(`/hiring/emails/${template.id}`))
  }

  return withAuth(auth, null)
}

export default EmailTemplatesList
