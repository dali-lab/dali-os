import { redirect } from 'react-router'
import type { Route } from './+types/rubrics.$id'
import { prisma } from '~/lib/db'
import { requireCoreOrDomainLead } from "~/lib/auth";
import { RubricDetail } from '~/hiring/components/RubricDetail'

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.rubric?.name
  return [{ title: `${name || 'Rubric'} · DALI OS` }]
}

export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { rubric?: { name: string } } | undefined)?.rubric?.name,
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireCoreOrDomainLead(request)
  if (!gate.ok) return gate.response

  const rubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: 'asc' },
      },
    },
  })

  return { rubric }
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireCoreOrDomainLead(request)
  if (!gate.ok) return gate.response
  const auth = gate.auth

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } })
  if (!user) return redirect('/login')

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

    return redirect(`/hiring/rubrics/${params.id}`)
  }

  return null
}

export default RubricDetail
