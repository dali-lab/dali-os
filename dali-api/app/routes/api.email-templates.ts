import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'
import { findManyEmailTemplatesWithCreatedBy } from '~/lib/email-template-authors'
import type { EmailTemplateType } from '~/generated/prisma/enums'
import type { Route } from './+types/api.email-templates'

const ALL_TYPES: EmailTemplateType[] = [
  'ApplicationReceived',
  'Rejected',
  'RejectedPostInterview',
  'InvitedToInterview',
  'InterviewInviteMentor',
  'Waitlisted',
  'Accepted',
]

// GET /api/email-templates
// Returns the current (latest version) template for each type, or null if never saved.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isHiringLead(auth.user.sub)))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch all templates ordered by newest first, then pick the latest per type
  const all = await findManyEmailTemplatesWithCreatedBy({
    orderBy: { createdAt: 'desc' },
  })

  const currentByType: Record<string, typeof all[number] | null> = {}
  for (const type of ALL_TYPES) {
    currentByType[type] = all.find(t => t.type === type) ?? null
  }

  return Response.json(currentByType)
}
