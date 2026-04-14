import { redirect } from 'react-router'
import type { Route } from './+types/rubrics.$id'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import { RubricDetail } from '~/components/RubricDetail'

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const [rubric, formVersions] = await Promise.all([
    prisma.rubric.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        domain: true,
        versions: {
          include: {
            createdBy: true,
            applicationFormVersion: true,
          },
          orderBy: { versionNumber: 'asc' },
        },
      },
    }),
    prisma.applicationFormVersion.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ])

  return { rubric, formVersions }
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } })
  if (!user) return redirect('/login')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create-version') {
    const criteriaJson = formData.get('criteria') as string
    const applicationFormVersionId = (formData.get('applicationFormVersionId') as string) || null
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
        applicationFormVersionId: applicationFormVersionId || undefined,
      },
    })

    return redirect(`/rubrics/${params.id}`)
  }

  return null
}

export default RubricDetail
