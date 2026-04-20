import { useState } from 'react'
import { redirect, useLoaderData } from 'react-router'
import { Mail, Send, ChevronDown, ChevronUp, RotateCcw, Users, CheckSquare, Square, Save, History, Clock } from 'lucide-react'
import { requireAuth } from '~/lib/auth'
import { isHiringLead } from '~/lib/roles'
import { prisma } from '~/lib/db'
import { getActiveCycle } from '~/lib/cycles'
import { parseAccessToken } from '~/lib/cookies'
import { PresenceProvider } from '~/components/collab/PresenceProvider'
import { PresenceBar } from '~/components/collab/PresenceBar'
import type { EmailTemplateType } from '~/generated/prisma/enums'
import type { Route } from './+types/hiring-lead.emails'

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (!(await isHiringLead(auth.user.sub))) return redirect('/')

  const collabToken = parseAccessToken(request)
  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } })
  const userName = member ? [member.firstName, member.lastName].filter(Boolean).join(' ') : 'Unknown'

  const cycle = await getActiveCycle()
  if (!cycle) return { cycle: null, recipientGroups: [], templatesByType: {}, collabToken, userName }

  // ── Recipients ──────────────────────────────────────────────────────────────
  function emailOf(user: { dartmouthEmail: string | null; daliEmail?: string | null; netId: string | null }): string | null {
    return user.dartmouthEmail ?? (user as any).daliEmail ?? (user.netId ? `${user.netId}@dartmouth.edu` : null)
  }

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
      include: { user: { select: { firstName: true, dartmouthEmail: true, netId: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'Accepted' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, netId: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'Rejected' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, netId: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'Waitlisted' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, netId: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { decisions: { some: { stage: 'Released', type: 'InvitedToInterview' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, netId: true } } },
    }),
    prisma.application.findMany({
      where: {
        applicationCycleId: cycle.id,
        domainApplications: { some: { interviews: { some: { status: 'Scheduled' } } } },
      },
      include: { user: { select: { firstName: true, dartmouthEmail: true, netId: true } } },
    }),
    prisma.cycleReviewer.findMany({
      where: { applicationCycleId: cycle.id },
      include: { daliMember: { select: { firstName: true, dartmouthEmail: true, daliEmail: true } } },
    }),
  ])

  function appToRecipient(a: { user: { firstName: string; dartmouthEmail: string | null; netId: string | null } }) {
    const email = emailOf(a.user)
    return email ? { firstName: a.user.firstName, email } : null
  }

  function reviewerToRecipient(r: { daliMember: { firstName: string | null; dartmouthEmail: string | null; daliEmail: string | null } }) {
    const email = r.daliMember.dartmouthEmail ?? r.daliMember.daliEmail
    return email ? { firstName: r.daliMember.firstName ?? 'Reviewer', email } : null
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

  // ── Templates from DB (all versions, newest first) ─────────────────────────
  const allTemplates = await prisma.emailTemplate.findMany({
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
  })

  // Group by type
  const templatesByType: Record<string, typeof allTemplates> = {}
  for (const t of allTemplates) {
    if (!templatesByType[t.type]) templatesByType[t.type] = []
    templatesByType[t.type].push(t)
  }

  return { cycle: { id: cycle.id, name: cycle.name }, recipientGroups, templatesByType, collabToken, userName }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Recipient = { firstName: string; email: string }
type RecipientGroup = { id: string; label: string; recipients: Recipient[] }
type DbTemplate = {
  id: string
  type: string
  subject: string
  body: string
  version: number
  createdAt: string
  createdBy: { id: string; firstName: string | null; lastName: string | null }
}

type TemplateDef = {
  type: EmailTemplateType
  label: string
  description: string
  defaultGroup: string
  compatibleGroups: string[]
  defaultSubject: string
  defaultBody: string
}

const TEMPLATE_DEFS: TemplateDef[] = [
  {
    type: 'ApplicationReceived',
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
    type: 'Rejected',
    label: '2. Rejection (Pre-Interview)',
    description: 'Sent to applicants rejected before the interview stage.',
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
    type: 'RejectedPostInterview',
    label: '2b. Rejection (Post-Interview)',
    description: 'Sent to applicants rejected after completing an interview.',
    defaultGroup: 'rejected',
    compatibleGroups: ['rejected', 'submitted_applicants'],
    defaultSubject: 'Your DALI Application',
    defaultBody: `Hi {{firstName}},

Thank you for interviewing with DALI. We really enjoyed getting to know you, and we appreciate the time and effort you put into both your application and interview.

After careful deliberation, we unfortunately will not be able to offer you a position for this cycle. This was an incredibly competitive cycle, and this decision does not reflect your abilities or potential.

We strongly encourage you to apply again in the future — many of our current members were not accepted on their first try.

Thank you again for your interest in DALI. We wish you all the best.

Warm regards,
The DALI Team`,
  },
  {
    type: 'InvitedToInterview',
    label: '3. Interview Invitation (Applicant)',
    description: 'Sent to applicants selected for an interview.',
    defaultGroup: 'interview_invited',
    compatibleGroups: ['interview_invited', 'submitted_applicants'],
    defaultSubject: "You're invited to interview with DALI!",
    defaultBody: `Hi {{firstName}},

Congratulations — we were impressed by your application and would love to invite you to interview with DALI!

Please log in to your application portal to view available interview slots and confirm your availability. Interviews are typically 20–30 minutes and held in person at the DALI Lab (Sudikoff 007).

If you have any scheduling conflicts or questions, please don't hesitate to reach out to us at applications@dali.dartmouth.edu.

We look forward to meeting you!

Best,
The DALI Team`,
  },
  {
    type: 'InterviewInviteMentor',
    label: '4. Interview Assignment (Mentor)',
    description: 'Sent to mentors/reviewers assigned to conduct interviews.',
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
    type: 'Waitlisted',
    label: '5. Waitlist',
    description: 'Sent to applicants placed on the waitlist.',
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
    type: 'Accepted',
    label: '6. Acceptance',
    description: 'Sent to applicants accepted into DALI.',
    defaultGroup: 'accepted',
    compatibleGroups: ['accepted'],
    defaultSubject: 'Welcome to DALI!',
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmailsPage() {
  const { cycle, recipientGroups, templatesByType, collabToken, userName } = useLoaderData<typeof loader>() as {
    cycle: { id: string; name: string } | null
    recipientGroups: RecipientGroup[]
    templatesByType: Record<string, DbTemplate[]>
    collabToken: string | null
    userName: string
  }

  // Local edits to subject/body (keyed by EmailTemplateType)
  const [subjects, setSubjects] = useState<Record<string, string>>({})
  const [bodies, setBodies] = useState<Record<string, string>>({})
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})

  // Which recipient group is selected per template
  const [selectedGroup, setSelectedGroup] = useState<Record<string, string>>({})
  // Excluded recipient emails per template
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({})

  const [expanded, setExpanded] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [sendResults, setSendResults] = useState<Record<string, { sent: number; failed: number } | null>>({})

  // After a save, we optimistically add the new version to the local state
  const [localTemplates, setLocalTemplates] = useState<Record<string, DbTemplate[]>>(templatesByType)

  function currentTemplate(type: string): DbTemplate | null {
    return localTemplates[type]?.[0] ?? null
  }

  function getSubject(def: TemplateDef) {
    return subjects[def.type] ?? currentTemplate(def.type)?.subject ?? def.defaultSubject
  }
  function getBody(def: TemplateDef) {
    return bodies[def.type] ?? currentTemplate(def.type)?.body ?? def.defaultBody
  }

  function isModified(def: TemplateDef) {
    const savedSubject = currentTemplate(def.type)?.subject ?? def.defaultSubject
    const savedBody = currentTemplate(def.type)?.body ?? def.defaultBody
    return (subjects[def.type] !== undefined && subjects[def.type] !== savedSubject) ||
      (bodies[def.type] !== undefined && bodies[def.type] !== savedBody)
  }

  function resetEdits(def: TemplateDef) {
    setSubjects(prev => { const n = { ...prev }; delete n[def.type]; return n })
    setBodies(prev => { const n = { ...prev }; delete n[def.type]; return n })
  }

  async function saveTemplate(def: TemplateDef) {
    setSaveStatus(prev => ({ ...prev, [def.type]: 'saving' }))
    try {
      const res = await fetch(`/api/email-templates/${def.type}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: getSubject(def), body: getBody(def) }),
      })
      if (res.ok) {
        const newTemplate = await res.json() as DbTemplate
        // Prepend to local history
        setLocalTemplates(prev => ({
          ...prev,
          [def.type]: [newTemplate, ...(prev[def.type] ?? [])],
        }))
        resetEdits(def)
        setSaveStatus(prev => ({ ...prev, [def.type]: 'saved' }))
        setTimeout(() => setSaveStatus(prev => ({ ...prev, [def.type]: 'idle' })), 2500)
      } else {
        setSaveStatus(prev => ({ ...prev, [def.type]: 'error' }))
      }
    } catch {
      setSaveStatus(prev => ({ ...prev, [def.type]: 'error' }))
    }
  }

  function getGroup(def: TemplateDef): RecipientGroup | null {
    const gid = selectedGroup[def.type] ?? def.defaultGroup
    return recipientGroups.find(g => g.id === gid) ?? null
  }

  function getRecipients(def: TemplateDef): Recipient[] {
    const group = getGroup(def)
    if (!group) return []
    const ex = excluded[def.type] ?? new Set<string>()
    return group.recipients.filter(r => !ex.has(r.email))
  }

  function toggleExclude(type: string, email: string) {
    setExcluded(prev => {
      const s = new Set(prev[type] ?? [])
      s.has(email) ? s.delete(email) : s.add(email)
      return { ...prev, [type]: s }
    })
  }

  async function sendBatch(def: TemplateDef) {
    const recipients = getRecipients(def)
    if (recipients.length === 0) return
    setSending(prev => ({ ...prev, [def.type]: true }))
    setSendResults(prev => ({ ...prev, [def.type]: null }))

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

    setSending(prev => ({ ...prev, [def.type]: false }))
    setSendResults(prev => ({ ...prev, [def.type]: { sent, failed } }))
  }

  function restoreVersion(def: TemplateDef, version: DbTemplate) {
    setSubjects(prev => ({ ...prev, [def.type]: version.subject }))
    setBodies(prev => ({ ...prev, [def.type]: version.body }))
  }

  if (!cycle) {
    return (
      <PresenceProvider pageId="emails" token={collabToken} userName={userName}>
        <div className="text-center py-16">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Emails</h1>
          <p className="text-gray-500">No active cycle found.</p>
        </div>
      </PresenceProvider>
    )
  }

  return (
    <PresenceProvider pageId="emails" token={collabToken} userName={userName}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Emails</h1>
          <p className="text-sm text-gray-500 mt-1">
            Send batch emails for <span className="font-medium text-gray-700">{cycle.name}</span>. Templates are saved with version history.
          </p>
        </div>
        <PresenceBar />
      </div>

      <div className="space-y-3">
        {TEMPLATE_DEFS.map(def => {
          const isOpen = expanded === def.type
          const group = getGroup(def)
          const recipients = getRecipients(def)
          const ex = excluded[def.type] ?? new Set<string>()
          const isSending = sending[def.type] ?? false
          const sendResult = sendResults[def.type]
          const modified = isModified(def)
          const ss = saveStatus[def.type] ?? 'idle'
          const current = currentTemplate(def.type)
          const history = localTemplates[def.type] ?? []
          const showHistory = historyOpen[def.type] ?? false

          return (
            <div key={def.type} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpanded(isOpen ? null : def.type)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{def.label}</p>
                      {current && (
                        <span className="text-xs text-gray-400">v{current.version}</span>
                      )}
                      {modified && <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">unsaved changes</span>}
                    </div>
                    <p className="text-xs text-gray-500">{def.description}</p>
                  </div>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-gray-200 divide-y divide-gray-100">
                  {/* Template editor */}
                  <div className="px-6 py-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Template</p>
                        {current && (
                          <span className="text-xs text-gray-400">
                            Last edited by {current.createdBy.firstName ?? 'Unknown'} {current.createdBy.lastName ?? ''} on {formatDate(current.createdAt)}
                          </span>
                        )}
                      </div>
                      {modified && (
                        <button
                          onClick={() => resetEdits(def)}
                          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition"
                        >
                          <RotateCcw className="w-3 h-3" /> Discard changes
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                      <input
                        type="text"
                        value={getSubject(def)}
                        onChange={e => setSubjects(prev => ({ ...prev, [def.type]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
                      <textarea
                        rows={7}
                        value={getBody(def)}
                        onChange={e => setBodies(prev => ({ ...prev, [def.type]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Use <code className="bg-gray-100 px-1 rounded">{'{{firstName}}'}</code> to personalize per recipient.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => saveTemplate(def)}
                        disabled={!modified || ss === 'saving'}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-900 hover:bg-gray-700 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {ss === 'saving' ? 'Saving...' : 'Save template'}
                      </button>
                      {ss === 'saved' && <span className="text-sm text-green-600 font-medium">Saved!</span>}
                      {ss === 'error' && <span className="text-sm text-red-600 font-medium">Save failed.</span>}
                    </div>
                  </div>

                  {/* Version history */}
                  {history.length > 0 && (
                    <div className="px-6 py-4">
                      <button
                        onClick={() => setHistoryOpen(prev => ({ ...prev, [def.type]: !showHistory }))}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition"
                      >
                        <History className="w-3.5 h-3.5" />
                        Version history ({history.length})
                        {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {showHistory && (
                        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                          {history.map(v => (
                            <div
                              key={v.id}
                              className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg text-sm"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-mono text-gray-400">v{v.version}</span>
                                <div>
                                  <p className="text-gray-900 font-medium">{v.subject}</p>
                                  <p className="text-xs text-gray-400 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDate(v.createdAt)} by {v.createdBy.firstName ?? 'Unknown'} {v.createdBy.lastName ?? ''}
                                  </p>
                                </div>
                              </div>
                              {v.id !== current?.id && (
                                <button
                                  onClick={() => restoreVersion(def, v)}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-medium transition"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recipient group + checklist */}
                  <div className="px-6 py-5 space-y-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recipients</p>

                    {def.compatibleGroups.length > 1 && (
                      <div className="flex gap-2 flex-wrap">
                        {def.compatibleGroups.map(gid => {
                          const g = recipientGroups.find(rg => rg.id === gid)
                          if (!g) return null
                          const active = (selectedGroup[def.type] ?? def.defaultGroup) === gid
                          return (
                            <button
                              key={gid}
                              onClick={() => setSelectedGroup(prev => ({ ...prev, [def.type]: gid }))}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}
                            >
                              {g.label} ({g.recipients.length})
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {group && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-gray-400" />
                            <span className="text-sm font-medium text-gray-700">{group.label}</span>
                            <span className="text-xs text-gray-400">({recipients.length} of {group.recipients.length})</span>
                          </div>
                          {ex.size > 0 && (
                            <button
                              onClick={() => setExcluded(prev => ({ ...prev, [def.type]: new Set() }))}
                              className="text-xs text-blue-600 hover:text-blue-800 transition"
                            >
                              Select all
                            </button>
                          )}
                        </div>
                        <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                          {group.recipients.length === 0 ? (
                            <p className="px-4 py-6 text-sm text-gray-400 text-center">No recipients in this group yet.</p>
                          ) : (
                            group.recipients.map(r => {
                              const isExcluded = ex.has(r.email)
                              return (
                                <button
                                  key={r.email}
                                  onClick={() => toggleExclude(def.type, r.email)}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition text-left"
                                >
                                  {isExcluded
                                    ? <Square className="w-4 h-4 text-gray-300 shrink-0" />
                                    : <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />}
                                  <span className={`text-sm ${isExcluded ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                    {r.firstName}
                                  </span>
                                  <span className={`text-xs ml-auto ${isExcluded ? 'text-gray-300' : 'text-gray-400'}`}>
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
                      {isSending ? 'Sending...' : `Send to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
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
    </PresenceProvider>
  )
}
