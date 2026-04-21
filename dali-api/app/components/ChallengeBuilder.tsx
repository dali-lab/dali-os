import React, { useCallback, useState, useRef } from 'react'
import { GripVertical, Plus, Pencil, Trash2, Save, X } from 'lucide-react'
import type { Question } from '~/types'
import { domains } from '~/mockData'
interface FormBuilderTabProps {
  initialQuestions?: Question[]
  onSave?: (questions: Question[]) => void
  onCancel?: () => void
}
export function FormBuilderTab({
  initialQuestions = [],
  onSave,
  onCancel,
}: FormBuilderTabProps) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Question>>({})
  const [optionsText, setOptionsText] = useState('')
  const [showForRoles, setShowForRoles] = useState<string[]>([])
  // Drag and drop state
  const dragItemRef = useRef<number | null>(null)
  const dragOverItemRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragItemRef.current = index
    dragOverItemRef.current = index
    setIsDragging(true)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    const el = e.currentTarget as HTMLElement
    requestAnimationFrame(() => {
      el.style.opacity = '0.4'
    })
  }
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])
  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragItemRef.current === null) return
    if (dragOverItemRef.current === index) return
    dragOverItemRef.current = index
    setQuestions((prev) => {
      const from = dragItemRef.current!
      const updated = [...prev]
      const [moved] = updated.splice(from, 1)
      updated.splice(index, 0, moved)
      dragItemRef.current = index
      return updated
    })
  }, [])
  const handleDragEnd = (e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '1'
    dragItemRef.current = null
    dragOverItemRef.current = null
    setIsDragging(false)
  }
  const handleEdit = (q: Question) => {
    setEditingKey(q.key)
    setEditForm(q)
    setOptionsText(q.data.options?.join('\n') || '')
    setShowForRoles(q.data.showForRoles || [])
    setIsAdding(false)
  }
  const handleDelete = (key: string) => {
    setQuestions(questions.filter((q) => q.key !== key))
  }
  const handleSaveEdit = () => {
    if (!editForm.key || !editForm.data?.label) return
    const updatedQuestion: Question = {
      key: editForm.key,
      type: editForm.type || 'text',
      required: editForm.required || false,
      data: {
        label: editForm.data.label,
        description: editForm.data.description,
        options:
          editForm.type === 'select'
            ? optionsText.split('\n').filter((o) => o.trim() !== '')
            : undefined,
        showForRoles: showForRoles.length > 0 ? showForRoles : undefined,
      },
    }
    if (isAdding) {
      setQuestions([...questions, updatedQuestion])
    } else {
      setQuestions(
        questions.map((q) => (q.key === editingKey ? updatedQuestion : q)),
      )
    }
    setEditingKey(null)
    setIsAdding(false)
    setEditForm({})
    setOptionsText('')
    setShowForRoles([])
  }
  const handleCancelEdit = () => {
    setEditingKey(null)
    setIsAdding(false)
    setEditForm({})
    setOptionsText('')
    setShowForRoles([])
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
    setShowForRoles([])
  }
  const toggleRole = (roleId: string) => {
    setShowForRoles((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    )
  }
  const renderEditForm = (isNew: boolean) => {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
              className="block w-full rounded-md border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
              placeholder="e.g. What is your major?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
              className="block w-full rounded-md border border-gray-300 bg-white text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
            >
              <option value="text">Short Text</option>
              <option value="textarea">Long Text</option>
              <option value="select">Dropdown Select</option>
              <option value="github_url">GitHub URL</option>
              <option value="figma_url">Figma URL</option>
            </select>
          </div>

          <div className="flex items-center mt-6">
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
              <span className="ml-2 text-sm text-gray-700">Required field</span>
            </label>
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
              className="block w-full rounded-md border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
              placeholder="e.g. Keep it under 200 words."
            />
          </div>

          {editForm.type === 'select' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Options (One per line)
              </label>
              <textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="block w-full rounded-md border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
                placeholder="Option 1&#10;Option 2&#10;Option 3"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={() => (isNew ? setIsAdding(false) : setEditingKey(null))}
            className="px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveEdit}
            className="px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
          >
            Save Question
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2" onDragOver={handleDragOver}>
        {questions.map((q, index) => (
          <div
            key={q.key}
            draggable={editingKey !== q.key}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-xl"
          >
            {editingKey === q.key ? (
              renderEditForm(false)
            ) : (
              <div
                className={`flex items-start gap-4 bg-white p-4 rounded-xl border shadow-sm group transition-colors duration-150 ${isDragging ? 'border-gray-300' : 'border-gray-200'}`}
              >
                <div className="mt-1 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 select-none">
                  <GripVertical className="w-5 h-5" />
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-medium text-gray-500">
                      Q{index + 1}
                    </span>
                    <h4 className="text-base font-medium text-gray-900">
                      {q.data.label}
                    </h4>
                    {q.required && (
                      <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        Required
                      </span>
                    )}
                    {q.data.showForRoles && q.data.showForRoles.length > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800">
                        Conditional
                      </span>
                    )}
                    <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full capitalize">
                      {q.type}
                    </span>
                  </div>

                  {q.data.description && (
                    <p className="text-sm text-gray-500 mb-2">
                      {q.data.description}
                    </p>
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

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(q)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(q.key)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
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
            className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <Plus className="w-5 h-5" />
            Add Question
          </button>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        {onSave && (
          <button
            onClick={() => onSave(questions)}
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
