// Admin → Email Templates: shared template library (Core-gated — hiring
// leads and other Core members author templates; only sender accounts are
// Admin-only). Moved here from /hiring/emails: templates serve every area,
// not just hiring.

import { redirect } from 'react-router'
import type { Route } from './+types/admin-console.email-templates'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { isCore, getUserRoles } from '~/lib/roles'
import { EmailTemplatesPage } from '~/admin-console/components/EmailTemplatesPage'

export const handle = { areaPills: true }

export const meta: Route.MetaFunction = () => [
  { title: 'Email Templates · Admin · DALI OS' },
]

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  const roles = await getUserRoles(auth.user.sub)
  if (!roles.isCore) return redirect('/')

  const templates = await prisma.emailTemplate.findMany({
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return { templates, isAdmin: roles.isAdmin }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isCore(auth.user.sub))) return redirect('/')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return { error: 'Name is required' }
    const template = await prisma.emailTemplate.create({ data: { name } })
    return redirect(`/admin-console/email-templates/${template.id}`)
  }

  return null
}

export default EmailTemplatesPage
