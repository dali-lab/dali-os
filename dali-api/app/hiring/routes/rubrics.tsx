import { redirect } from 'react-router'
import type { Route } from './+types/rubrics'
import { prisma } from '~/lib/db'
import { requireAuth, withAuth } from '~/lib/auth'
import { isHiringLead, isDomainLead } from '~/lib/roles'
import RubricsList from '~/hiring/components/Rubrics'

export const meta: Route.MetaFunction = () => [{ title: 'Rubrics · DALI OS' }]

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const rubrics = await prisma.rubric.findMany({
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return withAuth(auth, { rubrics })
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return withAuth(auth, { error: 'Name is required' })
    const rubric = await prisma.rubric.create({
      data: { name },
    })
    return withAuth(auth, redirect(`/hiring/rubrics/${rubric.id}`))
  }

  return withAuth(auth, null)
}

export default RubricsList
