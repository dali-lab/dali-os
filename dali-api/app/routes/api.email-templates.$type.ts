import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'
import {
  createEmailTemplateWithCreatedBy,
  findManyEmailTemplatesWithCreatedBy,
} from '~/lib/email-template-authors'
import type { EmailTemplateType } from '~/generated/prisma/enums'
import type { Route } from './+types/api.email-templates.$type'

const VALID_TYPES: Set<string> = new Set([
  'ApplicationReceived',
  'Rejected',
  'RejectedPostInterview',
  'InvitedToInterview',
  'InterviewInviteMentor',
  'Waitlisted',
  'Accepted',
])

// GET /api/email-templates/:type
// Returns the current (latest) template for this type, plus version history.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isHiringLead(auth.user.sub)))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  if (!VALID_TYPES.has(params.type))
    return Response.json({ error: 'Invalid template type' }, { status: 400 })

  const type = params.type as EmailTemplateType

  const versions = await findManyEmailTemplatesWithCreatedBy({
    where: { type },
    orderBy: { createdAt: 'desc' },
  })

  const current = versions[0] ?? null
  return Response.json({ current, history: versions })
}

// PUT /api/email-templates/:type
// Creates a new version of the template for this type.
export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isHiringLead(auth.user.sub)))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  if (request.method !== 'PUT')
    return Response.json({ error: 'Method not allowed' }, { status: 405 })

  if (!VALID_TYPES.has(params.type))
    return Response.json({ error: 'Invalid template type' }, { status: 400 })

  const type = params.type as EmailTemplateType
  const { subject, body } = await request.json()
  if (!subject || !body)
    return Response.json({ error: 'subject and body required' }, { status: 400 })

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } })
  if (!member)
    return Response.json({ error: 'Not a DALI member' }, { status: 403 })

  // Determine next version number
  const latest = await prisma.emailTemplate.findFirst({
    where: { type },
    orderBy: { createdAt: 'desc' },
    select: { version: true },
  })
  const nextVersion = (latest?.version ?? 0) + 1

  const template = await createEmailTemplateWithCreatedBy({
    type,
    subject,
    body,
    version: nextVersion,
    createdById: member.id,
  })

  return Response.json(template, { status: 201 })
}
