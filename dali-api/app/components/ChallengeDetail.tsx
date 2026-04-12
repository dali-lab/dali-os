import React, { useState } from 'react'
import { Link, useLoaderData, useSubmit, useSearchParams } from 'react-router'
import { ArrowLeft, Plus, FileText, Clock, UserIcon } from 'lucide-react'
import { FormBuilderTab } from '~/components/ChallengeBuilder'
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

export function ChallengeDetail() {
  const { challenge, domains: rawDomains } = useLoaderData<typeof loader>()
  const submit = useSubmit()
  const [searchParams] = useSearchParams()

  // General always first
  const domains = [
    ...rawDomains.filter((d) => d.name === 'General'),
    ...rawDomains.filter((d) => d.name !== 'General'),
  ]

  const defaultDomainId = searchParams.get('domainId') ?? domains[0]?.id ?? ''

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    challenge.versions.length ? challenge.versions[challenge.versions.length - 1].id : null
  )
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)
  const [selectedDomainId] = useState<string>(defaultDomainId)

  const selectedVersion = challenge.versions.find((v) => v.id === selectedVersionId)

  const nextVersionNumber = challenge.versions.length + 1

  const handleSaveNewVersion = (questions: Question[]) => {
    const formData = new FormData()
    formData.set('intent', 'create-version')
    formData.set('domainId', selectedDomainId)
    formData.set('questions', JSON.stringify(questions))
    submit(formData, { method: 'post' })
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/challenges"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Challenges
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{challenge.name}</h1>
            <p className="mt-1 text-gray-500">
              Created {new Date(challenge.createdAt).toLocaleDateString()}
            </p>
          </div>
          {!isCreatingVersion && (
            <button
              onClick={() => setIsCreatingVersion(true)}
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
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Versions</h3>
          {challenge.versions.length === 0 ? (
            <p className="text-sm text-gray-500">No versions yet.</p>
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
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-gray-900">v{versionNumber}</span>
                        <p className="text-xs text-gray-500">{version.domain.name}</p>
                        <p className="text-sm text-gray-500">
                          {(version.questions as unknown as Question[]).length} questions
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end text-xs text-gray-500 mb-0.5">
                          <Clock className="w-3 h-3 mr-1 flex-shrink-0" />
                          {formatDateTime(version.createdAt)}
                        </div>
                        <div className="flex items-center justify-end text-xs text-gray-500">
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
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="mb-6 pb-6 border-b border-gray-200 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Create New Version</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Build your new challenge version below. It will be saved as v{nextVersionNumber}.
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Domain</p>
                  <p className="text-sm text-gray-900">
                    {domains.find((d) => d.id === selectedDomainId)?.name ?? '—'}
                  </p>
                </div>
              </div>
              <FormBuilderTab
                initialQuestions={(selectedVersion?.questions as unknown as Question[]) || []}
                onSave={handleSaveNewVersion}
                onCancel={() => setIsCreatingVersion(false)}
              />
            </div>
          ) : selectedVersion ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Version {challenge.versions.findIndex((v) => v.id === selectedVersionId) + 1} Preview
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedVersion.domain.name} · Created by{' '}
                    {selectedVersion.createdBy.firstName} {selectedVersion.createdBy.lastName} on{' '}
                    {formatDateTime(selectedVersion.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => setIsCreatingVersion(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Duplicate to New Version
                </button>
              </div>
              <div className="p-6 space-y-4">
                {(selectedVersion.questions as unknown as Question[]).map((q, index) => (
                  <div
                    key={q.key}
                    className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-white"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-medium text-gray-500">Q{index + 1}</span>
                        <h4 className="text-base font-medium text-gray-900">{q.data.label}</h4>
                        {q.required && (
                          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            Required
                          </span>
                        )}
                        <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full capitalize">
                          {q.type}
                        </span>
                      </div>
                      {q.data.description && (
                        <p className="text-sm text-gray-500 mb-2">{q.data.description}</p>
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
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200 border-dashed">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No versions</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by creating a new version.</p>
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
