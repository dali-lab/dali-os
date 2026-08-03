import { useState, useEffect, type CSSProperties, type ReactNode } from 'react'
import { GripVertical, Plus, Pencil, Trash2, Save, Check, Loader2 } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Question } from '~/types'
import { DocEditor } from '~/components/doc'
import { Tooltip } from '~/components/ui/IconButton'
import { referenceSourceChoices, referenceSourceNeedsTerm } from '~/forms/lib/reference-sources.shared'

const ACCEPT_PRESETS = [
  { label: 'PDF', value: 'application/pdf' },
  { label: 'CAD / 3D', value: '.f3z,.f3d' },
] as const

function buildAcceptFromPresets(presets: Set<string>, custom: string): string {
  const parts: string[] = []
  for (const { value } of ACCEPT_PRESETS) {
    if (presets.has(value)) parts.push(...value.split(',').map((s) => s.trim()))
  }
  if (custom.trim()) {
    parts.push(...custom.split(',').map((s) => s.trim()).filter(Boolean))
  }
  return [...new Set(parts)].join(', ')
}

function parseAcceptIntoPresets(accept: string): { presets: Set<string>; custom: string } {
  const tokens = new Set(accept.split(',').map((s) => s.trim()).filter(Boolean))
  const selected = new Set<string>()
  const remaining = new Set(tokens)
  for (const { value } of ACCEPT_PRESETS) {
    const pts = value.split(',').map((s) => s.trim())
    if (pts.every((t) => tokens.has(t))) {
      selected.add(value)
      pts.forEach((t) => remaining.delete(t))
    }
  }
  return { presets: selected, custom: [...remaining].join(', ') }
}

export interface BuildQuestionInput {
  key: string
  type: Question['type']
  required: boolean
  label: string
  description?: string
  optionsText?: string
  accept?: string
  afterDomains?: boolean
  isGeneralForm?: boolean
  maxWordsEnabled?: boolean
  maxWordsValue?: number | string
  referenceSource?: string
  referenceTermId?: string
  // Multi-step forms: the 1-based step this question belongs to (default 1),
  // and an optional title for that step (authored on any question in the step;
  // fill surfaces show the first non-empty title per step).
  step?: number
  stepTitle?: string
}

export function buildQuestion(input: BuildQuestionInput): Question {
  const {
    key,
    type,
    required,
    label,
    description,
    optionsText,
    accept,
    afterDomains,
    isGeneralForm,
    maxWordsEnabled,
    maxWordsValue,
    referenceSource,
    referenceTermId,
    step,
    stepTitle,
  } = input

  let maxWords: number | undefined
  if (type === 'textarea' && maxWordsEnabled) {
    const raw =
      typeof maxWordsValue === 'number' ? maxWordsValue : String(maxWordsValue ?? '').trim()
    const parsed = raw === '' ? NaN : Number(raw)
    if (Number.isInteger(parsed) && parsed >= 1) {
      maxWords = parsed
    }
  }

  return {
    key,
    type,
    required,
    data: {
      label,
      description: description || undefined,
      options:
        type === 'select' || type === 'skills_rating' || type === 'checkbox'
          ? (optionsText ?? '').split('\n').filter((o) => o.trim() !== '')
          : undefined,
      accept: type === 'file' ? accept || undefined : undefined,
      afterDomains: isGeneralForm && afterDomains ? true : undefined,
      maxWords,
      referenceSource:
        type === 'reference' ? referenceSource || undefined : undefined,
      referenceTermId:
        type === 'reference' && referenceSourceNeedsTerm(referenceSource)
          ? referenceTermId || undefined
          : undefined,
      // Default step (1) is stored as undefined to keep single-step forms clean.
      step: step && step > 1 ? step : undefined,
      stepTitle: stepTitle?.trim() || undefined,
    },
  }
}

interface FormBuilderTabProps {
  initialQuestions?: Question[]
  initialDescription?: unknown
  onSave?: (payload: { questions: Question[]; description: unknown }) => void
  // Optional secondary "Save" (draft) action. When provided, a secondary
  // button is rendered alongside the primary one; the primary then becomes the
  // freeze-to-version action. Forms use this; hiring doesn't pass it.
  onSaveDraft?: (payload: { questions: Question[]; description: unknown }) => void
  // Label for the primary save button. Defaults to "Save Version" (hiring's
  // wording); Forms passes "Save as version".
  saveLabel?: string
  // Live save feedback for the two save buttons. The owner drives this from its
  // request state so the buttons can show "Saving…"/"Saved ✓" and disable while
  // a save is in flight. Omitted by hiring (buttons stay plain).
  saveStatus?: 'idle' | 'saving-draft' | 'saving-version' | 'saved-draft' | 'saved-version'
  onCancel?: () => void
  isGeneralForm?: boolean
  // Offer the checkbox (multi-select) question type. Only the Forms feature
  // passes true — the hiring application pipeline isn't array-answer-aware,
  // so hiring challenge builders don't get the option.
  allowCheckbox?: boolean
  // Terms offered for term-scoped reference sources (e.g. projects active in a
  // chosen term). Empty/omitted when no term picker is needed.
  terms?: { id: string; code: string }[]
}
export function FormBuilderTab({
  initialQuestions = [],
  initialDescription,
  onSave,
  onSaveDraft,
  saveLabel = 'Save Version',
  saveStatus = 'idle',
  onCancel,
  isGeneralForm = false,
  allowCheckbox = false,
  terms = [],
}: FormBuilderTabProps) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions)
  const [description, setDescription] = useState<unknown>(initialDescription ?? null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Question>>({})
  const [optionsText, setOptionsText] = useState('')
  const [maxWordsEnabled, setMaxWordsEnabled] = useState(false)
  const [maxWordsValue, setMaxWordsValue] = useState<string>('')
  const [acceptPresets, setAcceptPresets] = useState<Set<string>>(new Set())
  const [acceptCustom, setAcceptCustom] = useState('')
  // Drag-to-reorder via dnd-kit (same idiom as EpicSprintManager / KanbanBoard).
  // The reorder commits once, on drop — no per-move state churn — and the live
  // move is a CSS transform, so long forms stay responsive while dragging.
  // `activeId` only tints sibling borders for the duration of a drag.
  const [activeId, setActiveId] = useState<string | null>(null)
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    setQuestions((prev) => {
      const from = prev.findIndex((q) => q.key === active.id)
      const to = prev.findIndex((q) => q.key === over.id)
      if (from === -1 || to === -1) return prev
      return arrayMove(prev, from, to)
    })
  }
  const resetEditState = () => {
    setEditingKey(null)
    setEditForm({})
    setOptionsText('')
    setMaxWordsEnabled(false)
    setMaxWordsValue('')
    setAcceptPresets(new Set())
    setAcceptCustom('')
  }
  const handleEdit = (q: Question) => {
    setEditingKey(q.key)
    setEditForm(q)
    setOptionsText(q.data.options?.join('\n') || '')
    setMaxWordsEnabled(q.data.maxWords !== undefined)
    setMaxWordsValue(q.data.maxWords !== undefined ? String(q.data.maxWords) : '')
    if (q.type === 'file' && q.data.accept) {
      const { presets, custom } = parseAcceptIntoPresets(q.data.accept)
      setAcceptPresets(presets)
      setAcceptCustom(custom)
    } else {
      setAcceptPresets(new Set())
      setAcceptCustom('')
    }
  }
  const handleDelete = (key: string) => {
    setQuestions(questions.filter((q) => q.key !== key))
    if (editingKey === key) resetEditState()
  }

  // Auto-commit: edits to the inline form flow straight into the question list,
  // so there's no separate "Save Question" step — the question is part of the
  // form the moment it's added, and the top-level Save / Save as version is the
  // only thing that persists. The buffer (editForm + per-type field state) is
  // rebuilt into its list entry whenever any of it changes.
  useEffect(() => {
    if (!editingKey || !editForm.key) return
    const rebuilt = buildQuestion({
      key: editForm.key,
      type: editForm.type || 'text',
      required: editForm.required || false,
      label: editForm.data?.label || '',
      description: editForm.data?.description,
      optionsText,
      accept: buildAcceptFromPresets(acceptPresets, acceptCustom),
      afterDomains: editForm.data?.afterDomains,
      isGeneralForm,
      maxWordsEnabled,
      maxWordsValue,
      referenceSource: editForm.data?.referenceSource,
      referenceTermId: editForm.data?.referenceTermId,
      step: editForm.data?.step,
      stepTitle: editForm.data?.stepTitle,
    })
    setQuestions((prev) =>
      prev.map((q) => (q.key === editForm.key ? rebuilt : q)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editForm, optionsText, acceptPresets, acceptCustom, maxWordsEnabled, maxWordsValue])

  // Collapse the inline editor. The data is already in the list (auto-commit),
  // so this just closes the form — no save needed.
  const handleDoneEditing = () => {
    resetEditState()
  }

  const handleAddQuestion = () => {
    const key = `q-${Date.now()}`
    const newQuestion = buildQuestion({
      key,
      type: 'text',
      required: true,
      label: '',
      isGeneralForm,
    })
    // Append immediately and open it for inline editing — no staging step.
    setQuestions((prev) => [...prev, newQuestion])
    setEditingKey(key)
    setEditForm({ key, type: 'text', required: true, data: { label: '' } })
    setOptionsText('')
    setMaxWordsEnabled(false)
    setMaxWordsValue('')
    setAcceptPresets(new Set())
    setAcceptCustom('')
  }
  const renderEditForm = () => {
    return (
      <div className="bg-accent-coral/5 border border-accent-coral/30 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Question Label <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={editForm.data?.label || ''}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  data: {
                    ...editForm.data!,
                    label: e.target.value,
                  },
                })
              }
              className="block w-full rounded-md border border-gray-300 bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
              placeholder="e.g. What is your major?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Question Type
            </label>
            <select
              value={editForm.type || 'text'}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  type: e.target.value as any,
                })
              }
              className="block w-full rounded-md border border-gray-300 bg-card text-foreground shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
            >
              <option value="text">Short Text</option>
              <option value="textarea">Long Text</option>
              <option value="select">Dropdown Select</option>
              {(allowCheckbox || editForm.type === 'checkbox') && (
                <option value="checkbox">Checkboxes (multi-select)</option>
              )}
              <option value="github_url">GitHub URL</option>
              <option value="figma_url">Figma URL</option>
              <option value="drive_url">Google Drive URL</option>
              <option value="file">File Upload</option>
              <option value="skills_rating">Skills Rating</option>
              <option value="reference">Reference (from database)</option>
            </select>
          </div>

          <div className="flex items-center gap-6 mt-6">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.required || false}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    required: e.target.checked,
                  })
                }
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <span className="ml-2 text-sm text-foreground/80">Required field</span>
            </label>
            {isGeneralForm && (
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.data?.afterDomains || false}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      data: {
                        ...editForm.data!,
                        afterDomains: e.target.checked,
                      },
                    })
                  }
                  className="rounded border-gray-300 text-amber-600 shadow-sm focus:border-amber-300 focus:ring focus:ring-amber-200 focus:ring-opacity-50"
                />
                <span className="ml-2 text-sm text-gray-700">Show after domain questions</span>
              </label>
            )}
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              value={editForm.data?.description || ''}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  data: {
                    ...editForm.data!,
                    description: e.target.value,
                  },
                })
              }
              className="block w-full rounded-md border border-gray-300 bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
              placeholder="e.g. Keep it under 200 words."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Step (page)
            </label>
            <input
              type="number"
              min={1}
              value={editForm.data?.step ?? 1}
              onChange={(e) => {
                const n = Math.max(1, Math.floor(Number(e.target.value) || 1))
                setEditForm({
                  ...editForm,
                  data: { ...editForm.data!, step: n },
                })
              }}
              className="block w-24 rounded-md border border-gray-300 bg-card text-foreground shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Group questions into pages. 1 = first page.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Step title (Optional)
            </label>
            <input
              type="text"
              value={editForm.data?.stepTitle || ''}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  data: { ...editForm.data!, stepTitle: e.target.value },
                })
              }
              className="block w-full rounded-md border border-gray-300 bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
              placeholder="e.g. The Problem"
            />
          </div>

          {editForm.type === 'textarea' && (
            <div className="col-span-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={maxWordsEnabled}
                  onChange={(e) => setMaxWordsEnabled(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                />
                <span className="ml-2 text-sm text-foreground/80">Limit word count</span>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                disabled={!maxWordsEnabled}
                value={maxWordsValue}
                onChange={(e) => setMaxWordsValue(e.target.value)}
                className="w-28 rounded-md border border-gray-300 bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 disabled:bg-muted disabled:text-muted-foreground"
                placeholder="e.g. 200"
              />
              <span className="text-xs text-muted-foreground">words</span>
            </div>
          )}

          {(editForm.type === 'select' || editForm.type === 'checkbox') && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Options (One per line)
              </label>
              <textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="block w-full rounded-md border border-gray-300 bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
                placeholder="Option 1&#10;Option 2&#10;Option 3"
              />
            </div>
          )}

          {editForm.type === 'skills_rating' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Skills (One per line)
              </label>
              <textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="block w-full rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-accent-coral focus:ring-accent-coral sm:text-sm p-2"
                placeholder="JavaScript&#10;Python&#10;React.js&#10;Figma"
              />
              <p className="text-xs text-gray-500 mt-1">Applicants will rate each skill from 0-5.</p>
            </div>
          )}

          {editForm.type === 'reference' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Data source
              </label>
              <select
                value={editForm.data?.referenceSource || ''}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    data: {
                      ...editForm.data!,
                      referenceSource: e.target.value,
                    },
                  })
                }
                className="block w-full rounded-md border border-gray-300 bg-card text-foreground shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
              >
                <option value="">Select a source…</option>
                {referenceSourceChoices().map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Choices are pulled live when the form is filled — e.g. projects
                open for staffing this term.
              </p>

              {referenceSourceNeedsTerm(editForm.data?.referenceSource) && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Term
                  </label>
                  <select
                    value={editForm.data?.referenceTermId || ''}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        data: {
                          ...editForm.data!,
                          referenceTermId: e.target.value || undefined,
                        },
                      })
                    }
                    className="block w-full rounded-md border border-gray-300 bg-card text-foreground shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
                  >
                    <option value="">Select a term…</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Projects whose term set includes this term will be listed.
                  </p>
                </div>
              )}
            </div>
          )}

          {editForm.type === 'file' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Accepted File Types
              </label>
              <div className="flex flex-wrap gap-2 mb-3">
                {ACCEPT_PRESETS.map(({ label, value }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setAcceptPresets((prev) => {
                        const next = new Set(prev)
                        if (next.has(value)) next.delete(value)
                        else next.add(value)
                        return next
                      })
                    }
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      acceptPresets.has(value)
                        ? 'bg-accent-coral/15 text-accent-coral border-accent-coral/30'
                        : 'bg-card text-foreground/80 border-border hover:border-accent-coral/50 hover:bg-muted/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={acceptCustom}
                onChange={(e) => setAcceptCustom(e.target.value)}
                className="block w-full rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/70 shadow-sm focus:border-accent-coral focus:ring-accent-coral sm:text-sm p-2"
                placeholder="Additional types, e.g. .f3z, text/plain"
              />
              <p className="text-xs text-gray-500 mt-1">
                Toggle common presets above, or enter extra MIME types / extensions below (comma-separated).
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-3 pt-2">
          <Tooltip label="Remove question">
            <button
              type="button"
              onClick={() => editForm.key && handleDelete(editForm.key)}
              aria-label="Remove question"
              className="inline-flex items-center justify-center p-1.5 rounded-md text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <button
            onClick={handleDoneEditing}
            className="px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1">
          Description (Optional)
        </label>
        <p className="text-xs text-muted-foreground mb-2">
          Shown to applicants and reviewers above the question list.
        </p>
        {/* Block JSON from here on: onChange hands back the BlockNote block
            tree, and that's what drafts/versions persist. Callers pass
            loader-normalized blocks as initialDescription. */}
        <DocEditor
          features="notes"
          density="compact"
          aiEnabled
          initialContent={initialDescription ?? undefined}
          onChange={setDescription}
          placeholder="Describe this challenge for applicants…"
          className="rounded-md border border-gray-300 bg-card py-2 focus-within:border-blue-500"
        />
      </div>
      <div className="space-y-2">
        <DndContext
          sensors={dragSensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext
            items={questions.map((q) => q.key)}
            strategy={verticalListSortingStrategy}
          >
            {questions.map((q, index) => (
              <SortableQuestionRow key={q.key} id={q.key} disabled={editingKey === q.key}>
                {(dragHandleProps, isDragging) => (
                  <div className={`rounded-xl ${isDragging ? 'opacity-40' : ''}`}>
                    {editingKey === q.key ? (
                      renderEditForm()
                    ) : (
                      <div
                        className={`flex items-start gap-4 bg-card p-4 rounded-xl border shadow-sm group transition-colors duration-150 ${activeId ? 'border-gray-300' : 'border-border'}`}
                      >
                        <div
                          {...dragHandleProps}
                          aria-label={`Reorder ${q.data.label || 'question'}`}
                          className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-muted-foreground select-none touch-none"
                        >
                          <GripVertical className="w-5 h-5" />
                        </div>

                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-sm font-medium text-muted-foreground">
                              Q{index + 1}
                            </span>
                            <h4 className="text-base font-medium text-foreground">
                              {q.data.label}
                            </h4>
                            {q.required && (
                              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                                Required
                              </span>
                            )}
                            {q.data.afterDomains && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                                After Domains
                              </span>
                            )}
                            {q.type === 'textarea' && q.data.maxWords !== undefined && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">
                                Max {q.data.maxWords} words
                              </span>
                            )}
                            <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full capitalize">
                              {q.type}
                            </span>
                          </div>

                          {q.data.description && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {q.data.description}
                            </p>
                          )}

                          {(q.type === 'select' || q.type === 'skills_rating' || q.type === 'checkbox') && q.data.options && (
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

                          {q.type === 'file' && q.data.accept && (
                            <p className="text-xs text-gray-500 mt-1">Accepts: {q.data.accept}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEdit(q)}
                            className="p-1.5 text-muted-foreground/70 hover:text-blue-600 rounded-md hover:bg-blue-50"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(q.key)}
                            className="p-1.5 text-muted-foreground/70 hover:text-red-600 rounded-md hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SortableQuestionRow>
            ))}
          </SortableContext>
        </DndContext>

        <button
          onClick={handleAddQuestion}
          className="w-full py-4 border-2 border-dashed border-border rounded-xl text-muted-foreground hover:text-accent-coral hover:border-accent-coral/50 hover:bg-muted/40 transition-colors flex items-center justify-center gap-2 font-medium"
        >
          <Plus className="w-5 h-5" />
          Add Question
        </button>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        {(() => {
          const busy = saveStatus === 'saving-draft' || saveStatus === 'saving-version'
          return (
            <>
              {onCancel && (
                <button
                  onClick={onCancel}
                  disabled={busy}
                  className="px-4 py-2 border border-border shadow-sm text-sm font-medium rounded-lg text-foreground/80 bg-card hover:bg-muted/50 disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              {onSaveDraft && (
                <button
                  onClick={() => onSaveDraft({ questions, description })}
                  disabled={busy}
                  className="inline-flex items-center px-4 py-2 border border-border text-sm font-medium rounded-lg text-foreground bg-card hover:bg-muted/50 shadow-sm disabled:opacity-60"
                >
                  {saveStatus === 'saving-draft' ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                  ) : saveStatus === 'saved-draft' ? (
                    <><Check className="w-4 h-4 mr-2 text-green-600" /> Saved</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save</>
                  )}
                </button>
              )}
              {onSave && (
                <button
                  onClick={() => onSave({ questions, description })}
                  disabled={busy}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 shadow-sm disabled:opacity-60"
                >
                  {saveStatus === 'saving-version' ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                  ) : saveStatus === 'saved-version' ? (
                    <><Check className="w-4 h-4 mr-2" /> Saved</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> {saveLabel}</>
                  )}
                </button>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}

// Sortable wrapper for a question row. Owns the dnd-kit node ref + transform;
// hands the drag-handle props to the grip via a render prop so the rest of the
// row (edit/delete buttons, links) stays non-draggable. Disabled while the row
// is being inline-edited.
function SortableQuestionRow({
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
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const dragHandleProps = disabled
    ? {}
    : ({ ...attributes, ...listeners } as Record<string, unknown>)

  return (
    <div ref={setNodeRef} style={style}>
      {children(dragHandleProps, isDragging)}
    </div>
  )
}
