import { redirect } from 'react-router'
import type { Route } from './+types/rubrics'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { isHiringLead, isDomainLead } from '~/lib/roles'
import RubricsList from '~/components/Rubrics'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return redirect('/')

  const [rubrics, domains] = await Promise.all([
    prisma.rubric.findMany({
      include: {
        domain: true,
        versions: {
          include: { createdBy: true },
          orderBy: { versionNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.domain.findMany({ orderBy: { name: 'asc' } }),
  ])
  return { rubrics, domains }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return redirect('/')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const name = (formData.get('name') as string)?.trim()
    const domainId = (formData.get('domainId') as string) || null
    if (!name) return { error: 'Name is required' }
    const rubric = await prisma.rubric.create({
      data: { name, domainId },
    })
    return redirect(`/rubrics/${rubric.id}`)
  }

  return null
}

export default RubricsList
