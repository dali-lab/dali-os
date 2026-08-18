import { useState } from 'react'
import { Form, useLoaderData } from 'react-router'
import {
  Plus,
  Clock,
  UserIcon,
  Trash2,
} from 'lucide-react'
import type { loader } from '~/hiring/routes/rubrics.$id'
import type { RubricCriterion } from '~/types'
import { formatDateTime } from '~/lib/display'
import { useUserTimeZone } from '~/hooks/useUserTimeZone'

export function RubricDetail() {
  const { rubric } = useLoaderData<typeof loader>()
  const tz = useUserTimeZone()

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    rubric.versions.length ? rubric.versions[rubric.versions.length - 1].id : null,
  )
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)

  // Builder state
  const [criteria, setCriteria] = useState<RubricCriterion[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newMaxScore, setNewMaxScore] = useState(5)

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
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{rubric.name}</h1>
          </div>
          {!isCreatingVersion && (
            <button
              onClick={handleStartCreate}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Version
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
        {/* Left Sidebar: Versions List */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/50">
              <h3 className="font-bold text-foreground">Version History</h3>
            </div>
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {isCreatingVersion && (
                <button className="w-full text-left p-4 bg-accent-coral/5 border-l-4 border-accent-coral">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-foreground">Drafting New...</span>
                  </div>
                  <span className="text-xs text-accent-coral">Unsaved changes</span>
                </button>
              )}
              {rubric.versions
                .slice()
                .reverse()
                .map((version) => {
                  return (
                    <button
                      key={version.id}
                      onClick={() => {
                        setSelectedVersionId(version.id)
                        setIsCreatingVersion(false)
                      }}
                      className={`w-full text-left p-4 transition-colors ${
                        !isCreatingVersion && selectedVersionId === version.id
                          ? 'bg-accent-coral/5 border-l-4 border-accent-coral'
                          : 'hover:bg-muted/50 border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span
                          className={`font-bold ${
                            !isCreatingVersion && selectedVersionId === version.id
                              ? 'text-foreground'
                              : 'text-foreground'
                          }`}
                        >
                          Version {version.versionNumber}
                        </span>
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground mt-2 gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(version.createdAt, tz)}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground mt-1 gap-1">
                        <UserIcon className="w-3 h-3" />
                        {version.createdBy.firstName} {version.createdBy.lastName}
                      </div>
                    </button>
                  )
                })}
              {rubric.versions.length === 0 && !isCreatingVersion && (
                <div className="p-6 text-center text-muted-foreground text-sm italic">
                  No versions yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="min-w-0">
          {isCreatingVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[600px]">
              <div className="p-4 border-b border-border bg-muted/50 flex justify-between items-center">
                <div className="flex items-center gap-4 flex-wrap">
                  <h2 className="font-bold text-foreground">Drafting Version {nextVersionNumber}</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsCreatingVersion(false)}
                    className="px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted rounded-md"
                  >
                    Cancel
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="create-version" />
                    <input type="hidden" name="criteria" value={JSON.stringify(criteria)} />
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-sm font-medium text-white bg-accent-coral hover:bg-accent-coral/90 rounded-md"
                    >
                      Save Version
                    </button>
                  </Form>
                </div>
              </div>
              <div className="p-6 flex-1 bg-muted/50">
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="space-y-3">
                    {criteria.map((c) => (
                      <div
                        key={c.key}
                        className="bg-card border border-border rounded-lg p-4 flex gap-3 group"
                      >
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h4 className="font-bold text-foreground">{c.label}</h4>
                            <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-1 rounded">
                              Max: {c.maxScore}
                            </span>
                          </div>
                          {c.description && (
                            <p className="text-sm text-muted-foreground mt-1">{c.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveCriterion(c.key)}
                          className="text-muted-foreground/70 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {criteria.length === 0 && (
                      <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                        <p className="text-muted-foreground">No criteria added yet.</p>
                      </div>
                    )}
                  </div>

                  <div className="bg-card border border-border rounded-lg p-4">
                    <h4 className="text-sm font-bold text-foreground mb-3">Add Criterion</h4>
                    <div className="space-y-3">
                      <div className="grid grid-cols-4 gap-3">
                        <div className="col-span-3">
                          <input
                            type="text"
                            placeholder="Label (e.g. Communication)"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            className="w-full border border-border rounded-md p-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
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
                            className="w-full border border-border rounded-md p-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                          />
                        </div>
                      </div>
                      <input
                        type="text"
                        placeholder="Description (optional)"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCriterion()}
                        className="w-full border border-border rounded-md p-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                      />
                      <button
                        onClick={handleAddCriterion}
                        disabled={!newLabel.trim()}
                        className="w-full py-2 bg-muted text-foreground/80 font-medium rounded-md text-sm hover:bg-muted disabled:opacity-50"
                      >
                        Add Criterion
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden min-h-[600px]">
              <div className="p-6 border-b border-border flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-bold text-foreground">
                      Version {selectedVersion.versionNumber}
                    </h2>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDateTime(selectedVersion.createdAt, tz)}
                    </span>
                    <span className="flex items-center gap-1">
                      <UserIcon className="w-4 h-4" />
                      {selectedVersion.createdBy.firstName} {selectedVersion.createdBy.lastName}
                    </span>
                  </div>
                </div>
                <div className="bg-muted/50 px-4 py-2 rounded-lg border border-border text-center">
                  <span className="block text-2xl font-bold text-foreground">
                    {(selectedVersion.criteria as unknown as RubricCriterion[]).length}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Criteria
                  </span>
                </div>
              </div>
              <div className="p-6 bg-muted/50 min-h-full">
                <div className="max-w-2xl mx-auto space-y-4">
                  {(selectedVersion.criteria as unknown as RubricCriterion[]).map((c) => (
                    <div key={c.key} className="bg-card border border-border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-foreground">{c.label}</h4>
                        <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-1 rounded">
                          Max: {c.maxScore}
                        </span>
                      </div>
                      {c.description && (
                        <p className="text-sm text-muted-foreground mt-1">{c.description}</p>
                      )}
                    </div>
                  ))}
                  {(selectedVersion.criteria as unknown as RubricCriterion[]).length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No criteria in this version.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border shadow-sm flex items-center justify-center min-h-[600px] text-muted-foreground">
              Select a version to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
