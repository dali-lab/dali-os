import React, { useState } from 'react'
import { GripVertical, Plus, Pencil, Trash2, Save } from 'lucide-react'
import type { Question } from '~/types'
import { RichTextEditor } from '~/components/RichTextEditor'
import { referenceSourceChoices } from '~/forms/lib/reference-sources.shared'

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
        type === 'select' || type === 'skills_rating'
          ? (optionsText ?? '').split('\n').filter((o) => o.trim() !== '')
          : undefined,
      accept: type === 'file' ? accept || undefined : undefined,
      afterDomains: isGeneralForm && afterDomains ? true : undefined,
      maxWords,
      referenceSource:
        type === 'reference' ? referenceSource || undefined : undefined,
    },
  }
}

interface FormBuilderTabProps {
  initialQuestions?: Question[]
  initialDescription?: unknown
  onSave?: (payload: { questions: Question[]; description: unknown }) => void
  onCancel?: () => void
  isGeneralForm?: boolean
}
export function FormBuilderTab({
  initialQuestions = [],
  initialDescription,
  onSave,
  onCancel,
  isGeneralForm = false,
}: FormBuilderTabProps) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions)
  const [description, setDescription] = useState<unknown>(initialDescription ?? null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Question>>({})
  const [optionsText, setOptionsText] = useState('')
  const [maxWordsEnabled, setMaxWordsEnabled] = useState(false)
  const [maxWordsValue, setMaxWordsValue] = useState<string>('')
  const [acceptPresets, setAcceptPresets] = useState<Set<string>>(new Set())
  const [acceptCustom, setAcceptCustom] = useState('')
  // Drag and drop state. Track the source by key (stable across reorders) so
  // mid-drag splices don't invalidate it. Reorder happens on dragover of each
  // row, picking before/after based on whether the cursor is past the row's
  // vertical midpoint — more stable than dragenter, which can fire on inner
  // children and skip rows.
  const [dragKey, setDragKey] = useState<string | null>(null)
  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDragKey(key)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }
  const handleRowDragOver = (e: React.DragEvent, overKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragKey || dragKey === overKey) return
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    setQuestions((prev) => {
      const from = prev.findIndex((q) => q.key === dragKey)
      const overIdx = prev.findIndex((q) => q.key === overKey)
      if (from === -1 || overIdx === -1) return prev
      let to = after ? overIdx + 1 : overIdx
      if (from < to) to -= 1
      if (from === to) return prev
      const updated = [...prev]
      const [moved] = updated.splice(from, 1)
      updated.splice(to, 0, moved)
      return updated
    })
  }
  const handleDragEnd = () => {
    setDragKey(null)
  }
  const resetEditState = () => {
    setEditingKey(null)
    setIsAdding(false)
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
    setIsAdding(false)
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
  }
  const handleSaveEdit = () => {
    if (!editForm.key || !editForm.data?.label) return
    const updatedQuestion = buildQuestion({
      key: editForm.key,
      type: editForm.type || 'text',
      required: editForm.required || false,
      label: editForm.data.label,
      description: editForm.data.description,
      optionsText,
      accept: buildAcceptFromPresets(acceptPresets, acceptCustom),
      afterDomains: editForm.data.afterDomains,
      isGeneralForm,
      maxWordsEnabled,
      maxWordsValue,
      referenceSource: editForm.data.referenceSource,
    })
    if (isAdding) {
      setQuestions([...questions, updatedQuestion])
    } else {
      setQuestions(
        questions.map((q) => (q.key === editingKey ? updatedQuestion : q)),
      )
    }
    resetEditState()
  }
  const handleCancelEdit = () => {
    resetEditState()
  }
  const handleAddQuestion = () => {
    setIsAdding(true)
    setEditingKey('new')
    setEditForm({
      key: `q-${Date.now()}`,
      type: 'text',
      required: true,
      data: {
        label: '',
      },
    })
    setOptionsText('')
    setMaxWordsEnabled(false)
    setMaxWordsValue('')
    setAcceptPresets(new Set())
    setAcceptCustom('')
  }
  const renderEditForm = (isNew: boolean) => {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-4">
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

          {editForm.type === 'select' && (
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
                className="block w-full rounded-md border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
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
                        : 'bg-white text-gray-700 border-gray-300 hover:border-accent-coral/50'
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
                className="block w-full rounded-md border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
                placeholder="Additional types, e.g. .f3z, text/plain"
              />
              <p className="text-xs text-gray-500 mt-1">
                Toggle common presets above, or enter extra MIME types / extensions below (comma-separated).
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={handleCancelEdit}
            className="px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-foreground/80 bg-card hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveEdit}
            className="px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            Save Question
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
        <RichTextEditor
          value={description}
          onChange={setDescription}
          placeholder="Describe this challenge for applicants…"
        />
      </div>
      <div className="space-y-2">
        {questions.map((q, index) => (
          <div
            key={q.key}
            draggable={editingKey !== q.key}
            onDragStart={(e) => handleDragStart(e, q.key)}
            onDragOver={(e) => handleRowDragOver(e, q.key)}
            onDragEnd={handleDragEnd}
            onDrop={(e) => e.preventDefault()}
            className={`rounded-xl ${dragKey === q.key ? 'opacity-40' : ''}`}
          >
            {editingKey === q.key ? (
              renderEditForm(false)
            ) : (
              <div
                className={`flex items-start gap-4 bg-card p-4 rounded-xl border shadow-sm group transition-colors duration-150 ${dragKey ? 'border-gray-300' : 'border-border'}`}
              >
                <div className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-muted-foreground select-none">
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

                  {(q.type === 'select' || q.type === 'skills_rating') && q.data.options && (
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
        ))}

        {isAdding ? (
          renderEditForm(true)
        ) : (
          <button
            onClick={handleAddQuestion}
            className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-muted-foreground hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <Plus className="w-5 h-5" />
            Add Question
          </button>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-foreground/80 bg-card hover:bg-muted/50"
          >
            Cancel
          </button>
        )}
        {onSave && (
          <button
            onClick={() => onSave({ questions, description })}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 shadow-sm"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Version
          </button>
        )}
      </div>
    </div>
  )
}
