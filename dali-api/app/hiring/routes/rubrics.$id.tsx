import { redirect } from 'react-router'
import type { Route } from './+types/rubrics.$id'
import { prisma } from '~/lib/db'
import { requireAuth, withAuth } from '~/lib/auth'
import { isHiringLead, isDomainLead } from '~/lib/roles'
import { RubricDetail } from '~/hiring/components/RubricDetail'

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.rubric?.name
  return [{ title: `${name || 'Rubric'} · DALI OS` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const rubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'asc' },
      },
    },
  })

  return withAuth(auth, { rubric })
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return withAuth(auth, redirect('/'))

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } })
  if (!user) return withAuth(auth, redirect('/login'))

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create-version') {
    const criteriaJson = formData.get('criteria') as string
    const criteria = JSON.parse(criteriaJson || '[]')

    const lastVersion = await prisma.rubricVersion.findFirst({
      where: { rubricId: params.id },
      orderBy: { versionNumber: 'desc' },
    })
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1

    await prisma.rubricVersion.create({
      data: {
        rubricId: params.id,
        versionNumber,
        criteria,
        createdById: user.id,
      },
    })

    return withAuth(auth, redirect(`/hiring/rubrics/${params.id}`))
  }

  return withAuth(auth, null)
}

export default RubricDetail
