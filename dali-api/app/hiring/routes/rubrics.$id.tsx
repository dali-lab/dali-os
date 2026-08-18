import { redirect } from 'react-router'
import type { Route } from './+types/rubrics.$id'
import { prisma } from '~/lib/db'
import { requireCoreOrDomainLead } from "~/lib/auth";
import { redirectToLogin } from '~/lib/login-next'
import { parseSessionCookie } from '~/lib/cookies'
import { RubricDetail } from '~/hiring/components/RubricDetail'
import { driveFolderCrumbs } from '~/lib/drive-crumbs.server'
import { driveRootCrumbs } from '~/lib/drive-crumbs'
import { PageIcon } from '~/components/PageIcon'

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.rubric?.name
  return [{ title: `${name || 'Rubric'} · DALI OS` }]
}

export const handle = {
  // Rubrics live in Drive (under Hiring Forms); the bare /hiring/rubrics prefix
  // has no page so declare the full trail rooted at Drive.
  breadcrumbTrail: (data: unknown) => {
    const d = data as {
      rubric?: { name: string };
      driveCrumbs?: { scope: string; folders: { id: string; title: string; iconEmoji: string | null }[] } | null;
    } | undefined;
    const name = d?.rubric?.name;
    if (!name) return null;
    const scope = d?.driveCrumbs?.scope ?? "lab";
    return [
      ...driveRootCrumbs(scope),
      ...(d?.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=${scope}&folder=${f.id}`,
        icon: <PageIcon iconEmoji={f.iconEmoji} />,
      })),
      { label: name },
    ];
  },
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

  const driveCrumbs = await driveFolderCrumbs(rubric.folderPageId, gate.auth.user.sub, request)
  // Session token passed to useSharedArray for the rubric:{id}:draft collab room.
  const collabToken = parseSessionCookie(request)

  return { rubric, driveCrumbs, collabToken }
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireCoreOrDomainLead(request)
  if (!gate.ok) return gate.response
  const auth = gate.auth

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } })
  if (!user) return redirectToLogin(request)

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
