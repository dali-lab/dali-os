import { useState } from 'react'
import { Link, Form, useLoaderData } from 'react-router'
import {
  ArrowLeft,
  Plus,
  Clock,
  UserIcon,
  Trash2,
  GripVertical,
} from 'lucide-react'
import type { loader } from '~/routes/rubrics.$id'
import type { RubricCriterion } from '~/types'

function formatDateTime(iso: string | Date) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

export function RubricDetail() {
  const { rubric, formVersions } = useLoaderData<typeof loader>()

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    rubric.versions.length ? rubric.versions[rubric.versions.length - 1].id : null,
  )
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)

  // Builder state
  const [criteria, setCriteria] = useState<RubricCriterion[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newMaxScore, setNewMaxScore] = useState(5)
  const [selectedFormVersionId, setSelectedFormVersionId] = useState(formVersions[0]?.id ?? '')

  const selectedVersion = rubric.versions.find((v) => v.id === selectedVersionId)

  const handleStartCreate = () => {
    setIsCreatingVersion(true)
    setCriteria(selectedVersion ? (selectedVersion.criteria as unknown as RubricCriterion[]) : [])
  }

  const handleAddCriterion = () => {
    if (!newLabel.trim()) return
    setCriteria([
      ...criteria,
      {
        key: `crit-${Date.now()}`,
        label: newLabel.trim(),
        description: newDescription.trim(),
        maxScore: newMaxScore,
      },
    ])
    setNewLabel('')
    setNewDescription('')
    setNewMaxScore(5)
  }

  const handleRemoveCriterion = (key: string) => {
    setCriteria(criteria.filter((c) => c.key !== key))
  }

  const nextVersionNumber =
    rubric.versions.length > 0
      ? Math.max(...rubric.versions.map((v) => v.versionNumber)) + 1
      : 1

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/rubrics"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Rubrics
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{rubric.name}</h1>
            <p className="mt-1 text-gray-500">
              {rubric.domain ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                  {rubric.domain.name}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                  General
                </span>
              )}
            </p>
          </div>
          {!isCreatingVersion && (
            <button
              onClick={handleStartCreate}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Version
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left Sidebar: Versions List */}
        <div className="w-64 flex-shrink-0 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-bold text-gray-900">Version History</h3>
            </div>
            <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
              {isCreatingVersion && (
                <button className="w-full text-left p-4 bg-blue-50 border-l-4 border-blue-600">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-blue-900">Drafting New...</span>
                  </div>
                  <span className="text-xs text-blue-600">Unsaved changes</span>
                </button>
              )}
              {rubric.versions
                .slice()
                .reverse()
                .map((version) => {
                  const label = version.applicationFormVersion ? 'General Form' : 'No target'
                  return (
                    <button
                      key={version.id}
                      onClick={() => {
                        setSelectedVersionId(version.id)
                        setIsCreatingVersion(false)
                      }}
                      className={`w-full text-left p-4 transition-colors ${
                        !isCreatingVersion && selectedVersionId === version.id
                          ? 'bg-blue-50 border-l-4 border-blue-600'
                          : 'hover:bg-gray-50 border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span
                          className={`font-bold ${
                            !isCreatingVersion && selectedVersionId === version.id
                              ? 'text-blue-900'
                              : 'text-gray-900'
                          }`}
                        >
                          Version {version.versionNumber}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 block truncate">{label}</span>
                      <div className="flex items-center text-xs text-gray-500 mt-2 gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(version.createdAt)}
                      </div>
                      <div className="flex items-center text-xs text-gray-500 mt-1 gap-1">
                        <UserIcon className="w-3 h-3" />
                        {version.createdBy.firstName} {version.createdBy.lastName}
                      </div>
                    </button>
                  )
                })}
              {rubric.versions.length === 0 && !isCreatingVersion && (
                <div className="p-6 text-center text-gray-500 text-sm italic">
                  No versions yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1">
          {isCreatingVersion ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <div className="flex items-center gap-4 flex-wrap">
                  <h2 className="font-bold text-gray-900">Drafting Version {nextVersionNumber}</h2>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">Form version:</label>
                    <select
                      value={selectedFormVersionId}
                      onChange={(e) => setSelectedFormVersionId(e.target.value)}
                      className="border border-gray-300 rounded-md p-1.5 text-sm text-gray-900 bg-white focus:ring-blue-500 focus:border-blue-500"
                    >
                      {formVersions.length === 0 && (
                        <option value="">No form versions available</option>
                      )}
                      {formVersions.map((fv) => (
                        <option key={fv.id} value={fv.id}>
                          Form version {new Date(fv.createdAt).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsCreatingVersion(false)}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
                  >
                    Cancel
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="create-version" />
                    <input type="hidden" name="criteria" value={JSON.stringify(criteria)} />
                    <input type="hidden" name="applicationFormVersionId" value={selectedFormVersionId} />
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                    >
                      Save Version
                    </button>
                  </Form>
                </div>
              </div>
              <div className="p-6 flex-1 bg-gray-50">
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="space-y-3">
                    {criteria.map((c) => (
                      <div
                        key={c.key}
                        className="bg-white border border-gray-200 rounded-lg p-4 flex gap-3 group"
                      >
                        <div className="text-gray-400 mt-1">
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h4 className="font-bold text-gray-900">{c.label}</h4>
                            <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded">
                              Max: {c.maxScore}
                            </span>
                          </div>
                          {c.description && (
                            <p className="text-sm text-gray-500 mt-1">{c.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveCriterion(c.key)}
                          className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {criteria.length === 0 && (
                      <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                        <p className="text-gray-500">No criteria added yet.</p>
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-bold text-gray-900 mb-3">Add Criterion</h4>
                    <div className="space-y-3">
                      <div className="grid grid-cols-4 gap-3">
                        <div className="col-span-3">
                          <input
                            type="text"
                            placeholder="Label (e.g. Communication)"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            className="w-full border border-gray-300 rounded-md p-2 text-sm text-gray-900 bg-white focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div className="col-span-1">
                          <input
                            type="number"
                            min="1"
                            max="100"
                            placeholder="Max Score"
                            value={newMaxScore}
                            onChange={(e) => setNewMaxScore(parseInt(e.target.value) || 5)}
                            className="w-full border border-gray-300 rounded-md p-2 text-sm text-gray-900 bg-white focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <input
                        type="text"
                        placeholder="Description (optional)"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCriterion()}
                        className="w-full border border-gray-300 rounded-md p-2 text-sm text-gray-900 bg-white focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        onClick={handleAddCriterion}
                        disabled={!newLabel.trim()}
                        className="w-full py-2 bg-gray-100 text-gray-700 font-medium rounded-md text-sm hover:bg-gray-200 disabled:opacity-50"
                      >
                        Add Criterion
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedVersion ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden min-h-[600px]">
              <div className="p-6 border-b border-gray-200 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-bold text-gray-900">
                      Version {selectedVersion.versionNumber}
                    </h2>
                    {selectedVersion.applicationFormVersion ? (
                      <span className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                        General Form
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDateTime(selectedVersion.createdAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <UserIcon className="w-4 h-4" />
                      {selectedVersion.createdBy.firstName} {selectedVersion.createdBy.lastName}
                    </span>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 text-center">
                  <span className="block text-2xl font-bold text-gray-900">
                    {(selectedVersion.criteria as unknown as RubricCriterion[]).length}
                  </span>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Criteria
                  </span>
                </div>
              </div>
              <div className="p-6 bg-gray-50 min-h-full">
                <div className="max-w-2xl mx-auto space-y-4">
                  {(selectedVersion.criteria as unknown as RubricCriterion[]).map((c) => (
                    <div key={c.key} className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-gray-900">{c.label}</h4>
                        <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded">
                          Max: {c.maxScore}
                        </span>
                      </div>
                      {c.description && (
                        <p className="text-sm text-gray-500 mt-1">{c.description}</p>
                      )}
                    </div>
                  ))}
                  {(selectedVersion.criteria as unknown as RubricCriterion[]).length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-gray-500">No criteria in this version.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[600px] text-gray-500">
              Select a version to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
