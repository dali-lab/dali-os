import { useState, useEffect, useRef } from 'react'
import { Link, useLoaderData, useSubmit, useSearchParams, useNavigation, Form } from 'react-router'
import { ArrowLeft, Plus, FileText, Clock, UserIcon } from 'lucide-react'
import { FormBuilderTab } from '~/components/ChallengeBuilder'
import { RichTextViewer, isEmptyDoc } from '~/components/RichTextViewer'
import type { Question } from '~/types'
import type { loader } from '~/routes/admin.challenges.$id'

function formatDateTime(iso: string | Date) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

export function resolveChallengeFormDefaults({
  domains,
  versions,
  generalParam,
  domainIdParam,
}: {
  domains: { id: string; name: string }[]
  versions: { domainId: string | null }[]
  generalParam: string | null
  domainIdParam: string | null
}): { defaultDomainId: string; isGeneralForm: boolean } {
  const isGeneralIntent = generalParam === '1'
  const lastVersion = versions.length ? versions[versions.length - 1] : null
  const defaultDomainId = isGeneralIntent
    ? ''
    : (domainIdParam ?? lastVersion?.domainId ?? domains.find((d) => d.name !== 'General')?.id ?? domains[0]?.id ?? '')
  const isGeneralForm = isGeneralIntent || versions.some((v) => v.domainId === null)
  return { defaultDomainId, isGeneralForm }
}

export function ChallengeDetail() {
  const { challenge, domains: rawDomains } = useLoaderData<typeof loader>()
  const submit = useSubmit()
  const navigation = useNavigation()
  const [searchParams] = useSearchParams()

  // General always first
  const domains = [
    ...rawDomains.filter((d) => d.name === 'General'),
    ...rawDomains.filter((d) => d.name !== 'General'),
  ]

  const lastVersion = challenge.versions.length ? challenge.versions[challenge.versions.length - 1] : null
  const { defaultDomainId, isGeneralForm } = resolveChallengeFormDefaults({
    domains,
    versions: challenge.versions,
    generalParam: searchParams.get('general'),
    domainIdParam: searchParams.get('domainId'),
  })

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(lastVersion?.id ?? null)
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)
  const [selectedDomainId, setSelectedDomainId] = useState<string>(defaultDomainId)

  const selectedVersion = challenge.versions.find((v) => v.id === selectedVersionId)

  const nextVersionNumber = challenge.versions.length + 1

  // When loader data updates after a create-version submit, exit create mode and select the new version
  const prevVersionCount = useRef(challenge.versions.length)
  useEffect(() => {
    if (challenge.versions.length > prevVersionCount.current) {
      const newest = challenge.versions[challenge.versions.length - 1]
      setSelectedVersionId(newest.id)
      setIsCreatingVersion(false)
    }
    prevVersionCount.current = challenge.versions.length
  }, [challenge.versions.length])

  const handleSaveNewVersion = ({ questions, description }: { questions: Question[]; description: unknown }) => {
    const formData = new FormData()
    formData.set('intent', 'create-version')
    formData.set('domainId', selectedDomainId)
    formData.set('questions', JSON.stringify(questions))
    formData.set('description', description ? JSON.stringify(description) : '')
    submit(formData, { method: 'post' })
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/challenges"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Challenges
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{challenge.name}</h1>
            <p className="mt-1 text-muted-foreground">
              Created {new Date(challenge.createdAt).toLocaleDateString()}
            </p>
          </div>
          {!isCreatingVersion && (
            <button
              onClick={() => {
                if (selectedVersion && selectedVersion.domainId) setSelectedDomainId(selectedVersion.domainId)
                setIsCreatingVersion(true)
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Version
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left Sidebar: Versions List */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Versions</h3>
          {challenge.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {[...challenge.versions].reverse().map((version, i) => {
                const versionNumber = challenge.versions.length - i
                return (
                  <button
                    key={version.id}
                    onClick={() => {
                      setSelectedVersionId(version.id)
                      setIsCreatingVersion(false)
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      selectedVersionId === version.id && !isCreatingVersion
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                        : 'border-border bg-card hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-foreground">v{versionNumber}</span>
                        <p className="text-xs text-muted-foreground">{version.domain?.name ?? 'General'}</p>
                        <p className="text-sm text-muted-foreground">
                          {(version.questions as unknown as Question[]).length} questions
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end text-xs text-muted-foreground mb-0.5">
                          <Clock className="w-3 h-3 mr-1 flex-shrink-0" />
                          {formatDateTime(version.createdAt)}
                        </div>
                        <div className="flex items-center justify-end text-xs text-muted-foreground">
                          <UserIcon className="w-3 h-3 mr-1 flex-shrink-0" />
                          {version.createdBy.firstName} {version.createdBy.lastName}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Content: Form Builder or Preview */}
        <div className="flex-1">
          {isCreatingVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm p-6">
              <div className="mb-6 pb-6 border-b border-border space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Create New Version</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Build your new challenge version below. It will be saved as v{nextVersionNumber}.
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80 mb-1">Domain</p>
                  <p className="text-sm text-foreground">
                    {domains.find((d) => d.id === selectedDomainId)?.name ?? (isGeneralForm ? 'General' : '—')}
                  </p>
                </div>
              </div>
              <FormBuilderTab
                initialQuestions={(selectedVersion?.questions as unknown as Question[]) || []}
                initialDescription={selectedVersion?.description ?? null}
                onSave={handleSaveNewVersion}
                onCancel={() => setIsCreatingVersion(false)}
                isGeneralForm={isGeneralForm}
              />
            </div>
          ) : selectedVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-border bg-muted/50 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Version {challenge.versions.findIndex((v) => v.id === selectedVersionId) + 1} Preview
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedVersion.domain?.name ?? 'General'} · Created by{' '}
                    {selectedVersion.createdBy.firstName} {selectedVersion.createdBy.lastName} on{' '}
                    {formatDateTime(selectedVersion.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (selectedVersion.domainId) setSelectedDomainId(selectedVersion.domainId)
                    setIsCreatingVersion(true)
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Duplicate to New Version
                </button>
              </div>
              {/* Rubrics are now assigned at the domain+cycle level, not per challenge version */}

              <div className="p-6 space-y-4">
                {!isEmptyDoc(selectedVersion.description) && (
                  <div className="px-4 py-3 rounded-lg border border-border bg-muted/30">
                    <RichTextViewer content={selectedVersion.description} />
                  </div>
                )}
                {(selectedVersion.questions as unknown as Question[]).map((q, index) => (
                  <div
                    key={q.key}
                    className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-medium text-muted-foreground">Q{index + 1}</span>
                        <h4 className="text-base font-medium text-foreground">{q.data.label}</h4>
                        {q.required && (
                          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            Required
                          </span>
                        )}
                        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full capitalize">
                          {q.type}
                        </span>
                        {q.data.afterDomains && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                            After Domains
                          </span>
                        )}
                      </div>
                      {q.data.description && (
                        <p className="text-sm text-muted-foreground mb-2">{q.data.description}</p>
                      )}
                      {q.type === 'select' && q.data.options && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {q.data.options.map((opt) => (
                            <span
                              key={opt}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100"
                            >
                              {opt}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-xl border border-border border-dashed">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/70" />
              <h3 className="mt-2 text-sm font-medium text-foreground">No versions</h3>
              <p className="mt-1 text-sm text-muted-foreground">Get started by creating a new version.</p>
              <div className="mt-6">
                <button
                  onClick={() => setIsCreatingVersion(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Version
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
