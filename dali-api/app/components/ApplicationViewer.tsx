import { useState, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { applicationForms as forms, challenges, domains as allDomains } from '~/mockData'
import type { Application } from '~/types'

type HighlightColor = 'yellow' | 'green' | 'red' | 'blue'

interface Annotation {
  id: string
  fieldKey: string
  start: number
  end: number
  comment: string
  color: HighlightColor
}

interface Popover {
  x: number
  y: number
  start: number
  end: number
  fieldKey: string
  annotationId?: string // set when clicking an existing annotation
}

const COLOR_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-200 border-b-2 border-yellow-400',
  green: 'bg-green-200 border-b-2 border-green-400',
  red: 'bg-red-200 border-b-2 border-red-400',
  blue: 'bg-blue-200 border-b-2 border-blue-400',
}

const COLOR_OPTIONS: HighlightColor[] = ['yellow', 'green', 'red', 'blue']

function getQuestionLabel(key: string): string {
  for (const form of forms) {
    for (const version of form.versions) {
      const q = version.questions.find((q) => q.key === key)
      if (q) return q.data.label
    }
  }
  for (const challenge of challenges) {
    for (const version of challenge.versions) {
      const q = version.questions.find((q) => q.key === key)
      if (q) return q.data.label
    }
  }
  return key
}

function AnnotationMark({
  ann,
  highlighted,
  onAnnotationClick,
}: {
  ann: Annotation
  highlighted: string
  onAnnotationClick: (annotationId: string, x: number, y: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLElement>(null)

  return (
    <span className="relative inline">
      <mark
        ref={ref}
        className={`cursor-pointer rounded-sm ${COLOR_CLASSES[ann.color]}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation()
          onAnnotationClick(ann.id, e.clientX, e.clientY)
        }}
      >
        {highlighted}
      </mark>
      {hovered && ann.comment && ann.id !== '__pending__' && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <span className="block bg-gray-900 text-white text-xs rounded-lg px-3 py-2 max-w-xs whitespace-pre-wrap shadow-lg">
            {ann.comment}
          </span>
          <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
        </span>
      )}
    </span>
  )
}

// Split text into segments, applying annotations as highlighted spans
function renderAnnotatedText(
  text: string,
  fieldKey: string,
  annotations: Annotation[],
  onAnnotationClick: (annotationId: string, x: number, y: number) => void,
  pendingRange?: { start: number; end: number; color: HighlightColor },
) {
  const pending: Annotation[] = pendingRange
    ? [{ id: '__pending__', fieldKey, ...pendingRange, comment: '' }]
    : []
  const relevant = [...annotations.filter((a) => a.fieldKey === fieldKey), ...pending]
    .sort((a, b) => a.start - b.start)

  if (relevant.length === 0) return <span>{text}</span>

  const segments: React.ReactNode[] = []
  let cursor = 0

  for (const ann of relevant) {
    if (ann.start > cursor) {
      segments.push(<span key={`text-${cursor}`}>{text.slice(cursor, ann.start)}</span>)
    }
    const highlighted = text.slice(ann.start, ann.end)
    segments.push(
      <AnnotationMark
        key={ann.id}
        ann={ann}
        highlighted={highlighted}
        onAnnotationClick={onAnnotationClick}
      />,
    )
    cursor = ann.end
  }

  if (cursor < text.length) {
    segments.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return <>{segments}</>
}

interface AnnotatableFieldProps {
  fieldKey: string
  value: string
  annotations: Annotation[]
  onAddAnnotation: (ann: Omit<Annotation, 'id'>) => void
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void
  onDeleteAnnotation: (id: string) => void
}

function AnnotatableField({
  fieldKey,
  value,
  annotations,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: AnnotatableFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const [pendingComment, setPendingComment] = useState('')
  const [pendingColor, setPendingColor] = useState<HighlightColor>('yellow')

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !containerRef.current) return

    const range = sel.getRangeAt(0)
    const container = containerRef.current

    // Check selection is inside our container
    if (!container.contains(range.commonAncestorContainer)) return

    // Calculate offsets relative to the plain text content
    const preRange = document.createRange()
    preRange.setStart(container, 0)
    preRange.setEnd(range.startContainer, range.startOffset)
    const start = preRange.toString().length

    const end = start + range.toString().length
    if (start === end) return

    const rect = range.getBoundingClientRect()
    setPopover({
      x: rect.left + rect.width / 2,
      y: rect.bottom + window.scrollY + 8,
      start,
      end,
      fieldKey,
    })
    setPendingComment('')
    setPendingColor('yellow')
    sel.removeAllRanges()
  }, [fieldKey])

  const handleAnnotationClick = useCallback(
    (annotationId: string, x: number, y: number) => {
      const ann = annotations.find((a) => a.id === annotationId)
      if (!ann) return
      setPopover({
        x,
        y: y + window.scrollY + 8,
        start: ann.start,
        end: ann.end,
        fieldKey,
        annotationId,
      })
      setPendingComment(ann.comment)
      setPendingColor(ann.color)
    },
    [annotations, fieldKey],
  )

  const handleSave = () => {
    if (!popover) return
    if (popover.annotationId) {
      onUpdateAnnotation(popover.annotationId, {
        comment: pendingComment,
        color: pendingColor,
      })
    } else {
      onAddAnnotation({
        fieldKey: popover.fieldKey,
        start: popover.start,
        end: popover.end,
        comment: pendingComment,
        color: pendingColor,
      })
    }
    setPopover(null)
  }

  const handleDelete = () => {
    if (popover?.annotationId) {
      onDeleteAnnotation(popover.annotationId)
    }
    setPopover(null)
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="text-base text-gray-900 whitespace-pre-wrap leading-relaxed select-text cursor-text"
      >
        {renderAnnotatedText(
          value,
          fieldKey,
          annotations,
          handleAnnotationClick,
          popover && !popover.annotationId
            ? { start: popover.start, end: popover.end, color: pendingColor }
            : undefined,
        )}
      </div>

      {popover && (
        <>
          {/* Backdrop to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPopover(null)}
          />
          <div
            className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-3 w-64"
            style={{ left: Math.min(popover.x - 128, window.innerWidth - 272), top: popover.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                {popover.annotationId ? 'Edit annotation' : 'Add annotation'}
              </span>
              <button onClick={() => setPopover(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Color picker */}
            <div className="flex gap-1.5 mb-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setPendingColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    c === 'yellow' ? 'bg-yellow-300' :
                    c === 'green' ? 'bg-green-300' :
                    c === 'red' ? 'bg-red-300' : 'bg-blue-300'
                  } ${pendingColor === c ? 'border-gray-700 scale-110' : 'border-transparent'}`}
                />
              ))}
            </div>

            <textarea
              autoFocus
              rows={3}
              value={pendingComment}
              onChange={(e) => setPendingComment(e.target.value)}
              placeholder="Add a comment... (optional)"
              className="w-full text-sm text-gray-900 border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
                if (e.key === 'Escape') setPopover(null)
              }}
            />

            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSave}
                className="flex-1 text-xs font-medium bg-blue-600 text-white rounded-lg py-1.5 hover:bg-blue-700"
              >
                {popover.annotationId ? 'Update' : 'Highlight'}
              </button>
              {popover.annotationId && (
                <button
                  onClick={handleDelete}
                  className="text-xs font-medium text-red-600 hover:text-red-800 px-2"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 text-center">⌘↵ to save · Esc to cancel</p>
          </div>
        </>
      )}
    </div>
  )
}

interface ApplicationViewerProps {
  app: Application
}

export function ApplicationViewer({ app }: ApplicationViewerProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  const addAnnotation = (ann: Omit<Annotation, 'id'>) => {
    setAnnotations((prev) => [...prev, { ...ann, id: `ann-${Date.now()}` }])
  }

  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    )
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }

  const fieldProps = {
    annotations,
    onAddAnnotation: addAnnotation,
    onUpdateAnnotation: updateAnnotation,
    onDeleteAnnotation: deleteAnnotation,
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">General Information</h2>
          <span className="text-xs text-gray-400">Select text to annotate</span>
        </div>
        <div className="p-6 space-y-6">
          {Object.entries(app.answers).map(([key, value]) => (
            <div key={key}>
              <h3 className="text-sm font-medium text-gray-500 mb-1">
                {getQuestionLabel(key)}
              </h3>
              <AnnotatableField fieldKey={key} value={value} {...fieldProps} />
            </div>
          ))}
        </div>
      </div>

      {app.domainApplications.map((dapp) => {
        let domainName = 'Unknown Domain'
        for (const c of challenges) {
          const v = c.versions.find((v) => v.id === dapp.challengeVersionId)
          if (v) {
            const d = allDomains.find((d) => d.id === v.domainId)
            if (d) domainName = d.name
            break
          }
        }
        return (
          <div
            key={dapp.id}
            className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {domainName} Challenge
              </h2>
              <span className="text-xs text-gray-400">Select text to annotate</span>
            </div>
            <div className="p-6 space-y-6">
              {Object.entries(dapp.answers).map(([key, value]) => (
                <div key={key}>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">
                    {getQuestionLabel(key)}
                  </h3>
                  <AnnotatableField
                    fieldKey={`${dapp.id}:${key}`}
                    value={value}
                    {...fieldProps}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
