// The standalone email-templates page folded into the hiring Library's
// Emails tab. This route keeps the create action (the tab's modal POSTs
// here) and redirects GETs — including the Gmail OAuth return, whose
// gmail_authorized / gmail_error params must survive the hop.

import { redirect } from 'react-router'
import type { Route } from './+types/email-templates'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { isCore } from '~/lib/roles'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  url.searchParams.set('tab', 'emails')
  return redirect(`/hiring/library?${url.searchParams}`)
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
    return redirect(`/hiring/emails/${template.id}`)
  }

  return null
}
