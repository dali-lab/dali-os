import { redirect } from 'react-router'
import type { Route } from './+types/email-templates'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import EmailTemplatesList from '~/components/EmailTemplates'

export const meta: Route.MetaFunction = () => [{ title: 'Email templates · DALI OS' }]

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub))) return redirect('/')

  const templates = await prisma.emailTemplate.findMany({
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return { templates }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub))) return redirect('/')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return { error: 'Name is required' }
    const template = await prisma.emailTemplate.create({ data: { name } })
    return redirect(`/emails/${template.id}`)
  }

  return null
}

export default EmailTemplatesList
