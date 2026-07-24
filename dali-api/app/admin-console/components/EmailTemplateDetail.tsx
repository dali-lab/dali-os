import { useState, useMemo } from 'react'
import { Form, useLoaderData } from 'react-router'
import { Plus, Clock, UserIcon, Pencil, AlertTriangle } from 'lucide-react'
import type { loader } from '~/admin-console/routes/admin-console.email-templates.$id'
import {
  ALL_TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_DESCRIPTIONS,
  lintTemplate,
} from '~/hiring/lib/email-variables'
import { formatDateTime, fullName, UNKNOWN_LABEL } from '~/lib/display'
import { useUserTimeZone } from '~/hooks/useUserTimeZone'

function VariableReferencePanel() {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
      <p className="text-xs font-medium text-blue-900">Available placeholders</p>
      <p className="text-xs text-blue-900/80 mt-0.5">
        Templates are bound to a slot on the cycle Setup tab; not every slot fills every variable. The
        editor warns about unknown placeholders, and the cycle preview flags ones the bound slot won't fill.
      </p>
      <ul className="mt-2 space-y-0.5">
        {ALL_TEMPLATE_VARIABLES.map((name) => (
          <li key={name} className="text-xs text-blue-900">
            <code className="font-mono bg-blue-100 px-1 rounded">{`{{${name}}}`}</code>
            <span className="ml-2 text-blue-900/80">{TEMPLATE_VARIABLE_DESCRIPTIONS[name]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LintWarnings({ unknown, field }: { unknown: string[]; field: string }) {
  if (unknown.length === 0) return null
  return (
    <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        {field} contains unknown placeholder{unknown.length > 1 ? 's' : ''}{' '}
        {unknown.map((t, i) => (
          <span key={t}>
            {i > 0 && ', '}
            <code className="font-mono bg-amber-100 px-1 rounded">{`{{${t}}}`}</code>
          </span>
        ))}
        . These will ship as literal text. Check spelling — placeholders are case-sensitive.
      </span>
    </div>
  )
}

export function EmailTemplateDetail() {
  const { template } = useLoaderData<typeof loader>()
  const tz = useUserTimeZone()

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    template.versions[0]?.id ?? null,
  )
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)

  const selectedVersion = template.versions.find((v) => v.id === selectedVersionId) ?? null

  const [draftSubject, setDraftSubject] = useState(selectedVersion?.subject ?? '')
  const [draftBody, setDraftBody] = useState(selectedVersion?.body ?? '')
  const [draftName, setDraftName] = useState(template.name)

  const subjectLint = useMemo(() => lintTemplate(draftSubject), [draftSubject])
  const bodyLint = useMemo(() => lintTemplate(draftBody), [draftBody])

  const handleStartCreate = () => {
    setDraftSubject(selectedVersion?.subject ?? '')
    setDraftBody(selectedVersion?.body ?? '')
    setIsCreatingVersion(true)
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {isRenaming ? (
            <Form method="post" className="flex items-center gap-2" onSubmit={() => setIsRenaming(false)}>
              <input type="hidden" name="intent" value="rename" />
              <input
                type="text"
                name="name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="px-3 py-2 text-base text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[16rem]"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftName(template.name)
                  setIsRenaming(false)
                }}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
              >
                Cancel
              </button>
            </Form>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{template.name}</h1>
              <button
                type="button"
                onClick={() => setIsRenaming(true)}
                className="text-muted-foreground/70 hover:text-foreground"
                aria-label="Rename template"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {template.versions.length} version{template.versions.length !== 1 ? 's' : ''}
          </p>
        </div>

        {!isCreatingVersion && (
          <button
            type="button"
            onClick={handleStartCreate}
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Version
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            Versions
          </h2>
          {template.versions.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No versions yet.</p>
          )}
          {template.versions.map((v) => {
            const active = v.id === selectedVersionId && !isCreatingVersion
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVersionId(v.id)
                  setIsCreatingVersion(false)
                }}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  active
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-border bg-card hover:bg-muted/40 text-foreground'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">v{v.versionNumber}</span>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(v.createdAt, tz)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1 truncate">
                  <UserIcon className="w-3 h-3 shrink-0" />
                  {v.createdBy ? fullName(v.createdBy) || UNKNOWN_LABEL : UNKNOWN_LABEL}
                </p>
              </button>
            )
          })}
        </aside>

        <section className="bg-card rounded-xl border border-border p-6 shadow-sm">
          {isCreatingVersion ? (
            <Form method="post" className="space-y-4" onSubmit={() => setIsCreatingVersion(false)}>
              <input type="hidden" name="intent" value="create-version" />
              <VariableReferencePanel />
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Subject</label>
                <input
                  type="text"
                  name="subject"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <LintWarnings unknown={subjectLint.unknown} field="Subject" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  Body
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    Double newlines split paragraphs. See the variable list above for {'{{...}}'} placeholders.
                  </span>
                </label>
                <textarea
                  name="body"
                  rows={14}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-foreground font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <LintWarnings unknown={bodyLint.unknown} field="Body" />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingVersion(false)}
                  className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!draftSubject.trim() || !draftBody.trim()}
                  className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
                >
                  Save Version
                </button>
              </div>
            </Form>
          ) : selectedVersion ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Subject
                </h3>
                <p className="mt-1 text-base text-foreground">{selectedVersion.subject}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Body
                </h3>
                <pre className="mt-1 whitespace-pre-wrap text-sm text-foreground font-sans">
                  {selectedVersion.body}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground italic">
                No versions yet. Click "New Version" to create one.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
