import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'
import type { Route } from './+types/api.email-templates.$key'

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isHiringLead(auth.user.sub))) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const template = await (prisma as any).emailTemplate?.findUnique({
    where: { templateKey: params.key },
  }).catch(() => null)
  if (!template) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(template)
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isHiringLead(auth.user.sub))) return Response.json({ error: 'Forbidden' }, { status: 403 })

  if (request.method !== 'PUT') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const { subject, body } = await request.json()
  if (!subject || !body) return Response.json({ error: 'subject and body required' }, { status: 400 })

  const template = await (prisma as any).emailTemplate?.upsert({
    where: { templateKey: params.key },
    update: { subject, body },
    create: { templateKey: params.key, subject, body },
  }).catch(() => null)
  if (!template) return Response.json({ error: 'EmailTemplate table not yet migrated' }, { status: 503 })
  return Response.json(template)
}
