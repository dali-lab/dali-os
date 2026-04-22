import { useState } from 'react'
import { redirect, useLoaderData } from 'react-router'
import { Mail, Send, ChevronDown, ChevronUp, RotateCcw, Users, CheckSquare, Square, Save } from 'lucide-react'
import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'
import { getActiveCycle } from '~/lib/cycles'
import type { Route } from './+types/hiring-lead.emails'

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub))) return redirect('/')

  const cycle = await getActiveCycle()
  if (!cycle) return { cycle: null, recipientGroups: [], templates: [] }

  // ── Recipients ──────────────────────────────────────────────────────────────
  const [
    submittedApps,
    acceptedApps,
    rejectedApps,
    waitlistedApps,
    interviewInvitedApps,
    interviewScheduledApps,
    cycleReviewers,
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
    {
      id: 'submitted_applicants',
      label: 'All Submitted Applicants',
      recipients: submittedApps.map(appToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
    {
      id: 'accepted',
      label: 'Accepted Applicants',
      recipients: acceptedApps.map(appToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
    {
      id: 'rejected',
      label: 'Rejected Applicants',
      recipients: rejectedApps.map(appToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
    {
      id: 'waitlisted',
      label: 'Waitlisted Applicants',
      recipients: waitlistedApps.map(appToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
    {
      id: 'interview_invited',
      label: 'Interview-Invited Applicants',
      recipients: interviewInvitedApps.map(appToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
    {
      id: 'interview_scheduled',
      label: 'Applicants with Interview Scheduled',
      recipients: interviewScheduledApps.map(appToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
    {
      id: 'cycle_reviewers',
      label: 'All Reviewers This Cycle',
      recipients: cycleReviewers.map(reviewerToRecipient).filter(Boolean) as { firstName: string; email: string }[],
    },
  ]

  // ── Templates from DB ───────────────────────────────────────────────────────
  const dbTemplates = await (prisma as any).emailTemplate?.findMany().catch(() => []) ?? []

  return { cycle: { id: cycle.id, name: cycle.name }, recipientGroups, templates: dbTemplates }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Recipient = { firstName: string; email: string }
type RecipientGroup = { id: string; label: string; recipients: Recipient[] }
type DbTemplate = { templateKey: string; subject: string; body: string }

type TemplateDef = {
  key: string
  label: string
  description: string
  defaultGroup: string
  compatibleGroups: string[]
  defaultSubject: string
  defaultBody: string
}

const TEMPLATE_DEFS: TemplateDef[] = [
  {
    key: 'application_received',
    label: '1. Application Submitted',
    description: 'Sent right after an applicant submits their application.',
    defaultGroup: 'submitted_applicants',
    compatibleGroups: ['submitted_applicants'],
    defaultSubject: 'We received your DALI application!',
    defaultBody: `Hi {{firstName}},

Thank you for applying to DALI! We've received your application and our team will be reviewing it over the coming weeks.

We'll reach out with updates as decisions are made. In the meantime, feel free to reach out to us at applications@dali.dartmouth.edu if you have any questions.

Best,
The DALI Team`,
  },
  {
    key: 'rejection',
    label: '2. Rejection',
    description: 'Sent to applicants who were not selected to move forward.',
    defaultGroup: 'rejected',
    compatibleGroups: ['rejected', 'submitted_applicants'],
    defaultSubject: 'Your DALI Application',
    defaultBody: `Hi {{firstName}},

Thank you so much for applying to DALI and for the time and effort you put into your application. After careful consideration, we regret to inform you that we will not be moving forward with your application for this cycle.

This was an incredibly competitive cycle, and this decision is not a reflection of your abilities or potential. We strongly encourage you to apply again in the future — many of our current members were not accepted on their first try.

Thank you again for your interest in DALI. We wish you all the best.

Warm regards,
The DALI Team`,
  },
  {
    key: 'interview_invite_applicant',
    label: '3. Interview Invitation (Applicant)',
    description: 'Sent to applicants who have been selected for an interview.',
    defaultGroup: 'interview_invited',
    compatibleGroups: ['interview_invited', 'submitted_applicants'],
    defaultSubject: 'You\'re invited to interview with DALI!',
    defaultBody: `Hi {{firstName}},

Congratulations — we were impressed by your application and would love to invite you to interview with DALI!

Please log in to your application portal to view available interview slots and confirm your availability. Interviews are typically 20–30 minutes and held in person at the DALI Lab (Sudikoff 007).

If you have any scheduling conflicts or questions, please don't hesitate to reach out to us at applications@dali.dartmouth.edu.

We look forward to meeting you!

Best,
The DALI Team`,
  },
  {
    key: 'interview_invite_mentor',
    label: '4. Interview Invitation (Mentor)',
    description: 'Sent to mentors/reviewers who are assigned to conduct interviews.',
    defaultGroup: 'cycle_reviewers',
    compatibleGroups: ['cycle_reviewers'],
    defaultSubject: 'DALI interview assigned to you',
    defaultBody: `Hi {{firstName}},

You've been assigned to conduct an interview for the current DALI hiring cycle. Please log in to the reviewer dashboard to view your assigned applicant(s) and interview details.

If you have any conflicts or questions, please reach out to the hiring lead as soon as possible.

Thanks for your help making DALI hiring happen!

— The DALI Team`,
  },
  {
    key: 'waitlist',
    label: '5. Waitlist',
    description: 'Sent to applicants who have been placed on the waitlist.',
    defaultGroup: 'waitlisted',
    compatibleGroups: ['waitlisted'],
    defaultSubject: 'Update on your DALI application',
    defaultBody: `Hi {{firstName}},

Thank you for your patience as we reviewed applications for this cycle. We're excited to let you know that you've been placed on our waitlist!

This means we were very impressed by your application and interview, and if a spot opens up, we'd love to have you join the team. We'll be in touch with any updates.

Thank you again for your interest in DALI — we hope to work with you soon.

Best,
The DALI Team`,
  },
  {
    key: 'acceptance',
    label: '6. Acceptance',
    description: 'Sent to applicants who have been accepted into DALI.',
    defaultGroup: 'accepted',
    compatibleGroups: ['accepted'],
    defaultSubject: 'Welcome to DALI! 🎉',
    defaultBody: `Hi {{firstName}},

We are thrilled to offer you a spot in DALI!

After a highly competitive review process, we believe you'll be a fantastic addition to our team. Please log in to your application portal to confirm your acceptance.

Onboarding details and next steps will follow shortly. In the meantime, if you have any questions, feel free to reach out to us at applications@dali.dartmouth.edu.

Welcome to the family — we can't wait to work with you!

Warmly,
The DALI Team`,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function interpolate(text: string, firstName: string): string {
  return text.replace(/\{\{firstName\}\}/g, firstName)
}

function bodyToHtml(body: string): string {
  return body.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmailsPage() {
  const { cycle, recipientGroups, templates } = useLoaderData<typeof loader>() as {
    cycle: { id: string; name: string } | null
    recipientGroups: RecipientGroup[]
    templates: DbTemplate[]
  }

  // Local edits to subject/body (keyed by templateKey)
  const [subjects, setSubjects] = useState<Record<string, string>>({})
  const [bodies, setBodies] = useState<Record<string, string>>({})
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})

  // Which recipient group is selected per template
  const [selectedGroup, setSelectedGroup] = useState<Record<string, string>>({})
  // Excluded recipient emails per template
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({})

  const [expanded, setExpanded] = useState<string | null>(null)
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [sendResults, setSendResults] = useState<Record<string, { sent: number; failed: number } | null>>({})

  function dbSubject(key: string) {
    return templates.find(t => t.templateKey === key)?.subject || null
  }
  function dbBody(key: string) {
    return templates.find(t => t.templateKey === key)?.body || null
  }

  function getSubject(def: TemplateDef) {
    return subjects[def.key] ?? dbSubject(def.key) ?? def.defaultSubject
  }
  function getBody(def: TemplateDef) {
    return bodies[def.key] ?? dbBody(def.key) ?? def.defaultBody
  }

  function isModified(def: TemplateDef) {
    const savedSubject = dbSubject(def.key) || def.defaultSubject
    const savedBody = dbBody(def.key) || def.defaultBody
    return (subjects[def.key] !== undefined && subjects[def.key] !== savedSubject) ||
      (bodies[def.key] !== undefined && bodies[def.key] !== savedBody)
  }

  function resetEdits(def: TemplateDef) {
    setSubjects(prev => { const n = { ...prev }; delete n[def.key]; return n })
    setBodies(prev => { const n = { ...prev }; delete n[def.key]; return n })
  }

  async function saveTemplate(def: TemplateDef) {
    setSaveStatus(prev => ({ ...prev, [def.key]: 'saving' }))
    try {
      const res = await fetch(`/api/email-templates/${def.key}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: getSubject(def), body: getBody(def) }),
      })
      if (res.ok) {
        // Reflect saved values — clear local overrides so they now read from DB
        resetEdits(def)
        setSaveStatus(prev => ({ ...prev, [def.key]: 'saved' }))
        setTimeout(() => setSaveStatus(prev => ({ ...prev, [def.key]: 'idle' })), 2500)
      } else {
        setSaveStatus(prev => ({ ...prev, [def.key]: 'error' }))
      }
    } catch {
      setSaveStatus(prev => ({ ...prev, [def.key]: 'error' }))
    }
  }

  function getGroup(def: TemplateDef): RecipientGroup | null {
    const gid = selectedGroup[def.key] ?? def.defaultGroup
    return recipientGroups.find(g => g.id === gid) ?? null
  }

  function getRecipients(def: TemplateDef): Recipient[] {
    const group = getGroup(def)
    if (!group) return []
    const ex = excluded[def.key] ?? new Set<string>()
    return group.recipients.filter(r => !ex.has(r.email))
  }

  function toggleExclude(key: string, email: string) {
    setExcluded(prev => {
      const s = new Set(prev[key] ?? [])
      s.has(email) ? s.delete(email) : s.add(email)
      return { ...prev, [key]: s }
    })
  }

  async function sendBatch(def: TemplateDef) {
    const recipients = getRecipients(def)
    if (recipients.length === 0) return
    setSending(prev => ({ ...prev, [def.key]: true }))
    setSendResults(prev => ({ ...prev, [def.key]: null }))

    let sent = 0, failed = 0
    for (const r of recipients) {
      const subject = interpolate(getSubject(def), r.firstName)
      const html = bodyToHtml(interpolate(getBody(def), r.firstName))
      try {
        const res = await fetch('/api/email/send', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'custom', to: r.email, subject, html }),
        })
        res.ok ? sent++ : failed++
      } catch { failed++ }
    }

    setSending(prev => ({ ...prev, [def.key]: false }))
    setSendResults(prev => ({ ...prev, [def.key]: { sent, failed } }))
  }

  if (!cycle) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold text-foreground mb-2">Emails</h1>
        <p className="text-muted-foreground">No active cycle found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Emails</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send batch emails for <span className="font-medium text-foreground/80">{cycle.name}</span>. Templates are saved and shared across the team.
        </p>
      </div>

      <div className="space-y-3">
        {TEMPLATE_DEFS.map(def => {
          const isOpen = expanded === def.key
          const group = getGroup(def)
          const recipients = getRecipients(def)
          const ex = excluded[def.key] ?? new Set<string>()
          const isSending = sending[def.key] ?? false
          const sendResult = sendResults[def.key]
          const modified = isModified(def)
          const ss = saveStatus[def.key] ?? 'idle'

          return (
            <div key={def.key} className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpanded(isOpen ? null : def.key)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{def.label}</p>
                      {modified && <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">unsaved changes</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                  </div>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground/70 shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/70 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-border divide-y divide-gray-100">
                  {/* Template editor */}
                  <div className="px-6 py-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template</p>
                      {modified && (
                        <button
                          onClick={() => resetEdits(def)}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition"
                        >
                          <RotateCcw className="w-3 h-3" /> Discard changes
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Subject</label>
                      <input
                        type="text"
                        value={getSubject(def)}
                        onChange={e => setSubjects(prev => ({ ...prev, [def.key]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Body</label>
                      <textarea
                        rows={7}
                        value={getBody(def)}
                        onChange={e => setBodies(prev => ({ ...prev, [def.key]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
                      />
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Use <code className="bg-muted px-1 rounded">{'{{firstName}}'}</code> to personalize per recipient.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => saveTemplate(def)}
                        disabled={!modified || ss === 'saving'}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-900 hover:bg-gray-700 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {ss === 'saving' ? 'Saving…' : 'Save template'}
                      </button>
                      {ss === 'saved' && <span className="text-sm text-green-600 font-medium">Saved!</span>}
                      {ss === 'error' && <span className="text-sm text-red-600 font-medium">Save failed.</span>}
                    </div>
                  </div>

                  {/* Recipient group + checklist */}
                  <div className="px-6 py-5 space-y-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipients</p>

                    {def.compatibleGroups.length > 1 && (
                      <div className="flex gap-2 flex-wrap">
                        {def.compatibleGroups.map(gid => {
                          const g = recipientGroups.find(rg => rg.id === gid)
                          if (!g) return null
                          const active = (selectedGroup[def.key] ?? def.defaultGroup) === gid
                          return (
                            <button
                              key={gid}
                              onClick={() => setSelectedGroup(prev => ({ ...prev, [def.key]: gid }))}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-card text-muted-foreground border-gray-300 hover:border-blue-400'}`}
                            >
                              {g.label} ({g.recipients.length})
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {group && (
                      <div className="border border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-muted/50 border-b border-border flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-muted-foreground/70" />
                            <span className="text-sm font-medium text-foreground/80">{group.label}</span>
                            <span className="text-xs text-muted-foreground/70">({recipients.length} of {group.recipients.length})</span>
                          </div>
                          {ex.size > 0 && (
                            <button
                              onClick={() => setExcluded(prev => ({ ...prev, [def.key]: new Set() }))}
                              className="text-xs text-blue-600 hover:text-blue-800 transition"
                            >
                              Select all
                            </button>
                          )}
                        </div>
                        <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                          {group.recipients.length === 0 ? (
                            <p className="px-4 py-6 text-sm text-muted-foreground/70 text-center">No recipients in this group yet.</p>
                          ) : (
                            group.recipients.map(r => {
                              const isExcluded = ex.has(r.email)
                              return (
                                <button
                                  key={r.email}
                                  onClick={() => toggleExclude(def.key, r.email)}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition text-left"
                                >
                                  {isExcluded
                                    ? <Square className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                                    : <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />}
                                  <span className={`text-sm ${isExcluded ? 'text-muted-foreground/70 line-through' : 'text-foreground'}`}>
                                    {r.firstName}
                                  </span>
                                  <span className={`text-xs ml-auto ${isExcluded ? 'text-muted-foreground/50' : 'text-muted-foreground/70'}`}>
                                    {r.email}
                                  </span>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Send */}
                  <div className="px-6 py-4 flex items-center gap-4">
                    <button
                      onClick={() => sendBatch(def)}
                      disabled={recipients.length === 0 || isSending}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                      {isSending ? 'Sending…' : `Send to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
                    </button>
                    {sendResult && (
                      <span className={`text-sm font-medium ${sendResult.failed > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {sendResult.sent} sent{sendResult.failed > 0 ? `, ${sendResult.failed} failed` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
