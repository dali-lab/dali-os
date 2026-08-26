import { type CSSProperties, type ReactNode, useState } from 'react'
import { Form, useLoaderData } from 'react-router'
import {
  Plus,
  Clock,
  UserIcon,
  Trash2,
  GripVertical,
  Pencil,
  Undo2,
  Redo2,
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Tooltip } from "~/components/ui/floating";
import type { loader } from '~/hiring/routes/rubrics.$id'
import type { RubricCriterion } from '~/types'
import { formatDateTime } from '~/lib/display'
import { useUserTimeZone } from '~/hooks/useUserTimeZone'
import { useSharedArray } from '~/components/collab/useSharedCollection'
import { rubricDraftName } from '~/collab/roomName'
import {
  ManagedEditorShell,
  RestoreVersionButton,
} from '~/components/editor/ManagedEditorShell'

// ─── SortableCriterionRow ────────────────────────────────────────────────────

// Mirrors SortableQuestionRow in FormBuilder: owns the dnd-kit node ref +
// transform, hands drag-handle props to the grip via a render prop.
function SortableCriterionRow({
  id,
  disabled,
  children,
}: {
  id: string
  disabled: boolean
  children: (dragHandleProps: Record<string, unknown>, isDragging: boolean) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  const dragHandleProps = disabled ? {} : ({ ...attributes, ...listeners } as Record<string, unknown>)
  return (
    <div ref={setNodeRef} style={style}>
      {children(dragHandleProps, isDragging)}
    </div>
  )
}

// ─── RubricDetail ────────────────────────────────────────────────────────────

export function RubricDetail() {
  const { rubric, collabToken } = useLoaderData<typeof loader>()
  const tz = useUserTimeZone()

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    rubric.versions.length ? rubric.versions[rubric.versions.length - 1].id : null,
  )
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)

  // ── Add-criterion form state ─────────────────────────────────────────────
  const [newLabel, setNewLabel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newMaxScore, setNewMaxScore] = useState(5)

  // ── Inline edit state ────────────────────────────────────────────────────
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editMaxScore, setEditMaxScore] = useState(5)

  // ── Drag state ───────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null)
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const selectedVersion = rubric.versions.find((v) => v.id === selectedVersionId)

  // Bootstrap the collab room from the selected version's criteria so a new
  // room opens with the current saved snapshot (mirrors FormBuilder's pattern).
  const initialCriteria = selectedVersion
    ? (selectedVersion.criteria as unknown as RubricCriterion[])
    : []

  // Collab substrate: backed by a Hocuspocus Y.Array room when collabToken is
  // provided. Always called (stable hook call count); only active when drafting.
  // We pass collabToken only while isCreatingVersion so the room activates on
  // "New Version" and disconnects when the user cancels / saves.
  const collabActive = isCreatingVersion && !!collabToken
  const roomName = rubricDraftName(rubric.id)
  const {
    items: criteria,
    push: collabPush,
    remove: collabRemove,
    move: collabMove,
    setItems: collabSetItems,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSharedArray<RubricCriterion>(
    roomName,
    collabActive ? collabToken : null,
    'items',
    initialCriteria,
  )

  // ── Criterion mutators ───────────────────────────────────────────────────

  const handleStartCreate = () => {
    // Seed the room from the currently selected version before opening the editor.
    // The hook's bootstrap logic seeds an empty room; if the room already has
    // content (a peer edited it), we leave it as-is and the user can restore.
    setIsCreatingVersion(true)
  }

  const handleAddCriterion = () => {
    if (!newLabel.trim()) return
    const item: RubricCriterion = {
      key: `crit-${Date.now()}`,
      label: newLabel.trim(),
      description: newDescription.trim() || undefined,
      maxScore: newMaxScore,
    }
    collabPush(item)
    setNewLabel('')
    setNewDescription('')
    setNewMaxScore(5)
  }

  const handleRemoveCriterion = (key: string) => {
    const idx = criteria.findIndex((c) => c.key === key)
    if (idx !== -1) collabRemove(idx)
    if (editingKey === key) setEditingKey(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = criteria.findIndex((c) => c.key === active.id)
    const to = criteria.findIndex((c) => c.key === over.id)
    if (from === -1 || to === -1) return
    // Commits to Y.Array (undo-able); observer propagates back as `items`.
    collabMove(from, to)
  }

  const startEditing = (c: RubricCriterion) => {
    setEditingKey(c.key)
    setEditLabel(c.label)
    setEditDescription(c.description ?? '')
    setEditMaxScore(c.maxScore)
  }

  const commitEdit = () => {
    if (!editingKey) return
    const next = criteria.map((c) =>
      c.key === editingKey
        ? { ...c, label: editLabel.trim() || c.label, description: editDescription.trim() || undefined, maxScore: editMaxScore }
        : c,
    )
    collabSetItems(next)
    setEditingKey(null)
  }

  const handleRestoreVersion = (versionCriteria: RubricCriterion[]) => {
    collabSetItems(versionCriteria)
    setIsCreatingVersion(true)
  }

  const nextVersionNumber =
    rubric.versions.length > 0
      ? Math.max(...rubric.versions.map((v) => v.versionNumber)) + 1
      : 1

  // ── Version sidebar (shared by ManagedEditorShell) ───────────────────────

  const versionSidebar = (
    <>
      <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
        Version History
      </h2>
      {isCreatingVersion && (
        <button className="w-full text-left rounded-lg border border-accent-coral bg-accent-coral/5 px-3 py-2">
          <span className="font-medium text-foreground">v{nextVersionNumber}</span>
          <span className="block text-xs text-accent-coral mt-0.5">Unsaved draft</span>
        </button>
      )}
      {rubric.versions
        .slice()
        .reverse()
        .map((version) => {
          const vCriteria = version.criteria as unknown as RubricCriterion[]
          const active = !isCreatingVersion && selectedVersionId === version.id
          return (
            <div key={version.id} className="group">
              <button
                onClick={() => {
                  setSelectedVersionId(version.id)
                  setIsCreatingVersion(false)
                  setEditingKey(null)
                }}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  active
                    ? 'border-accent-coral bg-accent-coral/5 text-foreground'
                    : 'border-border bg-card hover:bg-muted/40 text-foreground'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">Version {version.versionNumber}</span>
                </div>
                <div className="flex items-center text-xs text-muted-foreground mt-1 gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(version.createdAt, tz)}
                </div>
                <div className="flex items-center text-xs text-muted-foreground mt-1 gap-1">
                  <UserIcon className="w-3 h-3" />
                  {version.createdBy.firstName} {version.createdBy.lastName}
                </div>
              </button>
              {/* Restore affordance: seeds the working draft from this version. */}
              {isCreatingVersion && (
                <div className="px-3 pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <RestoreVersionButton onRestore={() => handleRestoreVersion(vCriteria)} />
                </div>
              )}
            </div>
          )
        })}
      {rubric.versions.length === 0 && !isCreatingVersion && (
        <p className="text-sm text-muted-foreground italic">No versions yet.</p>
      )}
    </>
  )

  return (
    <ManagedEditorShell
      name={rubric.name}
      isDrafting={isCreatingVersion}
      headerActions={
        !isCreatingVersion ? (
          <button
            onClick={handleStartCreate}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Version
          </button>
        ) : null
      }
      versionSidebar={versionSidebar}
    >
      {isCreatingVersion ? (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[500px]">
          {/* Editor toolbar */}
          <div className="p-4 border-b border-border bg-muted/50 flex justify-between items-center flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h2 className="font-bold text-foreground">Drafting Version {nextVersionNumber}</h2>
              {/* Undo/Redo: backed by native Y.UndoManager — no y-prosemirror bug class. */}
              {collabToken && (
                <div className="flex items-center gap-1">
                  <Tooltip content="Undo (⌘Z)">
                    <button
                      type="button"
                      onClick={undo}
                      disabled={!canUndo}
                      aria-label="Undo"
                      className="inline-flex items-center justify-center p-1.5 rounded-md text-foreground/70 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Undo2 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Redo (⌘⇧Z)">
                    <button
                      type="button"
                      onClick={redo}
                      disabled={!canRedo}
                      aria-label="Redo"
                      className="inline-flex items-center justify-center p-1.5 rounded-md text-foreground/70 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Redo2 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsCreatingVersion(false)
                  setEditingKey(null)
                }}
                className="px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted rounded-md"
              >
                Cancel
              </button>
              {/* Snapshot: client posts current Y.Array contents to create-version. */}
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

          {/* Criteria list */}
          <div className="p-6 flex-1 bg-muted/50">
            <div className="max-w-2xl mx-auto space-y-3">
              <DndContext
                sensors={dragSensors}
                collisionDetection={closestCenter}
                onDragStart={(e) => setActiveId(String(e.active.id))}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveId(null)}
              >
                <SortableContext
                  items={criteria.map((c) => c.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {criteria.map((c) => (
                    <SortableCriterionRow
                      key={c.key}
                      id={c.key}
                      disabled={editingKey === c.key}
                    >
                      {(dragHandleProps, isDragging) =>
                        editingKey === c.key ? (
                          // Inline edit form — no separate panel; edits commit on "Done".
                          <div className="bg-accent-coral/5 border border-accent-coral/30 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-4 gap-3">
                              <div className="col-span-3">
                                <label className="block text-xs font-medium text-foreground/70 mb-1">Label</label>
                                <input
                                  type="text"
                                  value={editLabel}
                                  onChange={(e) => setEditLabel(e.target.value)}
                                  className="w-full border border-border rounded-md p-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                                  autoFocus
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="block text-xs font-medium text-foreground/70 mb-1">Max Score</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={editMaxScore}
                                  onChange={(e) => setEditMaxScore(parseInt(e.target.value) || 1)}
                                  className="w-full border border-border rounded-md p-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                                />
                              </div>
                            </div>
                            <input
                              type="text"
                              placeholder="Description (optional)"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="w-full border border-border rounded-md p-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                            />
                            <div className="flex justify-between">
                              <Tooltip content="Remove criterion">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCriterion(c.key)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-md"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </Tooltip>
                              <button
                                type="button"
                                onClick={commitEdit}
                                className="px-3 py-1.5 text-sm font-medium text-white bg-accent-coral hover:bg-accent-coral/90 rounded-md"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`bg-card border border-border rounded-lg p-4 flex gap-3 group transition-opacity ${isDragging ? 'opacity-40' : ''} ${activeId ? 'border-border/60' : ''}`}
                          >
                            {/* Drag handle */}
                            <div
                              {...dragHandleProps}
                              aria-label={`Reorder ${c.label}`}
                              className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-muted-foreground select-none touch-none"
                            >
                              <GripVertical className="w-5 h-5" />
                            </div>
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
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => startEditing(c)}
                                className="p-1.5 text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-muted"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveCriterion(c.key)}
                                className="p-1.5 text-muted-foreground/70 hover:text-red-600 rounded-md hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )
                      }
                    </SortableCriterionRow>
                  ))}
                </SortableContext>
              </DndContext>

              {criteria.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                  <p className="text-muted-foreground">No criteria added yet.</p>
                </div>
              )}

              {/* Add-criterion form */}
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
                    type="button"
                    onClick={handleAddCriterion}
                    disabled={!newLabel.trim()}
                    className="w-full py-2 bg-muted text-foreground/80 font-medium rounded-md text-sm hover:bg-muted/80 disabled:opacity-50"
                  >
                    Add Criterion
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : selectedVersion ? (
        // Read-only view of a saved version
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden min-h-[500px]">
          <div className="p-6 border-b border-border flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">
                Version {selectedVersion.versionNumber}
              </h2>
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
          <div className="p-6 bg-muted/50">
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
        <div className="bg-card rounded-xl border border-border shadow-sm flex items-center justify-center min-h-[500px] text-muted-foreground">
          Select a version to view details
        </div>
      )}
    </ManagedEditorShell>
  )
}
