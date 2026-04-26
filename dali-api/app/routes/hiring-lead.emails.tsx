import { useState } from 'react'
import { Link, redirect, useLoaderData } from 'react-router'
import { Mail, Send, Users, CheckSquare, Square, ExternalLink } from 'lucide-react'
import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'
import { getActiveCycle } from '~/lib/cycles'
import { interpolate, bodyToHtml } from '~/lib/email'
import type { Route } from './+types/hiring-lead.emails'

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub))) return redirect('/')

  const cycle = await getActiveCycle()
  if (!cycle) return { cycle: null, recipientGroups: [], templates: [] }

  const [
    submittedApps,
    acceptedApps,
    rejectedApps,
    waitlistedApps,
    interviewInvitedApps,
    interviewScheduledApps,
    cycleReviewers,
    templates,
  ] = await Promise.all([
    prisma.application.findMany({
      where: { applicationCycleId: cycle.id, statusUpdates: { some: { newStatus: 'Submitted' } } },
      include: { user: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'Accepted' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'Rejected' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'Waitlisted' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'InvitedToInterview' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { interviews: { some: { status: 'Scheduled' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
    prisma.cycleReviewer.findMany({
      where: { applicationCycleId: cycle.id },
      include: { daliMember: { select: { firstName: true, user: { select: { daliEmail: true, dartmouthEmail: true } } } } },
    }),
    prisma.emailTemplate.findMany({
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    }),
  ])

  function appToRecipient(a: { user: { firstName: string; dartmouthEmail: string | null; daliEmail: string | null } }) {
    const email = a.user.dartmouthEmail ?? a.user.daliEmail
    if (!email) return null
    return { firstName: a.user.firstName, email }
  }

  function reviewerToRecipient(r: { daliMember: { firstName: string | null; user: { daliEmail: string | null; dartmouthEmail: string | null } | null } }) {
    const email = r.daliMember.user?.daliEmail ?? r.daliMember.user?.dartmouthEmail
    if (!email) return null
    return { firstName: r.daliMember.firstName ?? 'Reviewer', email }
  }

  const recipientGroups = [
    { id: 'submitted_applicants', label: 'All Submitted Applicants', recipients: submittedApps.map(appToRecipient).filter(Boolean) as Recipient[] },
    { id: 'accepted', label: 'Accepted Applicants', recipients: acceptedApps.map(appToRecipient).filter(Boolean) as Recipient[] },
    { id: 'rejected', label: 'Rejected Applicants', recipients: rejectedApps.map(appToRecipient).filter(Boolean) as Recipient[] },
    { id: 'waitlisted', label: 'Waitlisted Applicants', recipients: waitlistedApps.map(appToRecipient).filter(Boolean) as Recipient[] },
    { id: 'interview_invited', label: 'Interview-Invited Applicants', recipients: interviewInvitedApps.map(appToRecipient).filter(Boolean) as Recipient[] },
    { id: 'interview_scheduled', label: 'Applicants with Interview Scheduled', recipients: interviewScheduledApps.map(appToRecipient).filter(Boolean) as Recipient[] },
    { id: 'cycle_reviewers', label: 'All Reviewers This Cycle', recipients: cycleReviewers.map(reviewerToRecipient).filter(Boolean) as Recipient[] },
  ]

  // Only surface templates that have at least one version (otherwise there's nothing to send).
  const sendableTemplates = templates
    .filter(t => t.versions.length > 0)
    .map(t => ({
      id: t.id,
      name: t.name,
      latest: {
        id: t.versions[0].id,
        versionNumber: t.versions[0].versionNumber,
        subject: t.versions[0].subject,
        body: t.versions[0].body,
      },
    }))

  return {
    cycle: { id: cycle.id, name: cycle.name },
    recipientGroups,
    templates: sendableTemplates,
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Recipient = { firstName: string; email: string }
type SendableTemplate = {
  id: string
  name: string
  latest: { id: string; versionNumber: number; subject: string; body: string }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmailsPage() {
  const { cycle, recipientGroups, templates } = useLoaderData<typeof loader>() as {
    cycle: { id: string; name: string } | null
    recipientGroups: { id: string; label: string; recipients: Recipient[] }[]
    templates: SendableTemplate[]
  }

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id ?? '')
  const [selectedGroupId, setSelectedGroupId] = useState<string>(recipientGroups[0]?.id ?? '')
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null)

  if (!cycle) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold text-foreground">Send Batch Email</h1>
        <p className="mt-4 text-muted-foreground">No active cycle found.</p>
      </div>
    )
  }

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null
  const selectedGroup = recipientGroups.find(g => g.id === selectedGroupId) ?? null
  const recipients = (selectedGroup?.recipients ?? []).filter(r => !excluded.has(r.email))

  const previewSubject = selectedTemplate
    ? interpolate(selectedTemplate.latest.subject, recipients[0]?.firstName ?? 'Sample')
    : ''
  const previewHtml = selectedTemplate
    ? bodyToHtml(interpolate(selectedTemplate.latest.body, recipients[0]?.firstName ?? 'Sample'))
    : ''

  function toggleExcluded(email: string) {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  async function handleSend() {
    if (!selectedTemplate || recipients.length === 0) return
    setSending(true)
    setSendResult(null)
    let sent = 0
    let failed = 0
    for (const r of recipients) {
      const subject = interpolate(selectedTemplate.latest.subject, r.firstName)
      const html = bodyToHtml(interpolate(selectedTemplate.latest.body, r.firstName))
      try {
        const res = await fetch('/api/email/send', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: r.email, subject, html }),
        })
        if (res.ok) sent++
        else failed++
      } catch {
        failed++
      }
    }
    setSendResult({ sent, failed })
    setSending(false)
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2">
            <Mail className="w-6 h-6 text-blue-600" />
            Send Batch Email
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a template and a recipient group for <span className="font-medium text-foreground">{cycle.name}</span>.
          </p>
        </div>
        <Link
          to="/email-templates"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Manage templates <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm text-orange-800">
          No email templates yet. <Link to="/email-templates" className="underline font-medium">Create one</Link> first.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-bold text-foreground/80">Template</h2>
              <select
                value={selectedTemplateId}
                onChange={e => { setSelectedTemplateId(e.target.value); setSendResult(null) }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} — v{t.latest.versionNumber}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <Link
                  to={`/email-templates/${selectedTemplate.id}`}
                  className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                >
                  Edit this template <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-bold text-foreground/80 inline-flex items-center gap-2">
                <Users className="w-4 h-4" />
                Recipients
              </h2>
              <select
                value={selectedGroupId}
                onChange={e => { setSelectedGroupId(e.target.value); setExcluded(new Set()); setSendResult(null) }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {recipientGroups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.label} ({g.recipients.length})
                  </option>
                ))}
              </select>
              <div className="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                {(selectedGroup?.recipients ?? []).length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground italic">No recipients in this group.</p>
                ) : (
                  (selectedGroup?.recipients ?? []).map(r => {
                    const isExcluded = excluded.has(r.email)
                    return (
                      <button
                        key={r.email}
                        type="button"
                        onClick={() => toggleExcluded(r.email)}
                        className="w-full flex items-center gap-2 p-2 text-left text-sm hover:bg-muted/40"
                      >
                        {isExcluded ? (
                          <Square className="w-4 h-4 text-muted-foreground/70" />
                        ) : (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        )}
                        <span className={isExcluded ? 'text-muted-foreground/70 line-through' : ''}>
                          {r.firstName} — {r.email}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''} selected</p>
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !selectedTemplate || recipients.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : `Send to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
            </button>

            {sendResult && (
              <div className={`rounded-lg p-3 text-sm ${sendResult.failed > 0 ? 'bg-orange-50 border border-orange-200 text-orange-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
                Sent {sendResult.sent}{sendResult.failed > 0 ? ` — ${sendResult.failed} failed` : ''}
              </div>
            )}
          </div>

          <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-3 sticky top-4 self-start">
            <h2 className="text-sm font-bold text-foreground/80">Preview (first recipient)</h2>
            {selectedTemplate ? (
              <>
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</h3>
                  <p className="mt-1 text-sm text-foreground">{previewSubject}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body</h3>
                  <div
                    className="mt-1 prose prose-sm max-w-none text-foreground"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">Pick a template to preview.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
