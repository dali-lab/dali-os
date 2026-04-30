import { useState, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import type { Question } from '~/types'
import { RichTextViewer, isEmptyDoc } from '~/components/RichTextViewer'

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
  annotationId?: string
}

const COLOR_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-200 border-b-2 border-yellow-400',
  green: 'bg-green-200 border-b-2 border-green-400',
  red: 'bg-red-200 border-b-2 border-red-400',
  blue: 'bg-blue-200 border-b-2 border-blue-400',
}

const COLOR_OPTIONS: HighlightColor[] = ['yellow', 'green', 'red', 'blue']

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
  const relevant = [...annotations.filter((a) => a.fieldKey === fieldKey), ...pending].sort(
    (a, b) => a.start - b.start,
  )

  if (relevant.length === 0) return <span>{text}</span>

  const segments: React.ReactNode[] = []
  let cursor = 0

  for (const ann of relevant) {
    if (ann.start > cursor) {
      segments.push(<span key={`text-${cursor}`}>{text.slice(cursor, ann.start)}</span>)
    }
    segments.push(
      <AnnotationMark
        key={ann.id}
        ann={ann}
        highlighted={text.slice(ann.start, ann.end)}
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
    if (!container.contains(range.commonAncestorContainer)) return
    const preRange = document.createRange()
    preRange.setStart(container, 0)
    preRange.setEnd(range.startContainer, range.startOffset)
    const start = preRange.toString().length
    const end = start + range.toString().length
    if (start === end) return
    const rect = range.getBoundingClientRect()
    setPopover({ x: rect.left + rect.width / 2, y: rect.bottom + window.scrollY + 8, start, end, fieldKey })
    setPendingComment('')
    setPendingColor('yellow')
    sel.removeAllRanges()
  }, [fieldKey])

  const handleAnnotationClick = useCallback(
    (annotationId: string, x: number, y: number) => {
      const ann = annotations.find((a) => a.id === annotationId)
      if (!ann) return
      setPopover({ x, y: y + window.scrollY + 8, start: ann.start, end: ann.end, fieldKey, annotationId })
      setPendingComment(ann.comment)
      setPendingColor(ann.color)
    },
    [annotations, fieldKey],
  )

  const handleSave = () => {
    if (!popover) return
    if (popover.annotationId) {
      onUpdateAnnotation(popover.annotationId, { comment: pendingComment, color: pendingColor })
    } else {
      onAddAnnotation({ fieldKey: popover.fieldKey, start: popover.start, end: popover.end, comment: pendingComment, color: pendingColor })
    }
    setPopover(null)
  }

  const handleDelete = () => {
    if (popover?.annotationId) onDeleteAnnotation(popover.annotationId)
    setPopover(null)
  }

  return (
    <div className="relative">
      <div ref={containerRef} onMouseUp={handleMouseUp}
        className="text-base text-foreground whitespace-pre-wrap leading-relaxed select-text cursor-text">
        {renderAnnotatedText(value, fieldKey, annotations, handleAnnotationClick,
          popover && !popover.annotationId ? { start: popover.start, end: popover.end, color: pendingColor } : undefined)}
      </div>

      {popover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
          <div
            className="fixed z-50 bg-card rounded-xl shadow-xl border border-border p-3 w-64"
            style={{ left: Math.min(popover.x - 128, window.innerWidth - 272), top: popover.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {popover.annotationId ? 'Edit annotation' : 'Add annotation'}
              </span>
              <button onClick={() => setPopover(null)} className="text-muted-foreground/70 hover:text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-1.5 mb-2">
              {COLOR_OPTIONS.map((c) => (
                <button key={c} onClick={() => setPendingColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${c === 'yellow' ? 'bg-yellow-300' : c === 'green' ? 'bg-green-300' : c === 'red' ? 'bg-red-300' : 'bg-blue-300'} ${pendingColor === c ? 'border-gray-700 scale-110' : 'border-transparent'}`} />
              ))}
            </div>
            <textarea autoFocus rows={3} value={pendingComment}
              onChange={(e) => setPendingComment(e.target.value)}
              placeholder="Add a comment... (optional)"
              className="w-full text-sm text-foreground border border-border rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave(); if (e.key === 'Escape') setPopover(null) }}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleSave} className="flex-1 text-xs font-medium bg-blue-600 text-white rounded-lg py-1.5 hover:bg-blue-700">
                {popover.annotationId ? 'Update' : 'Highlight'}
              </button>
              {popover.annotationId && (
                <button onClick={handleDelete} className="text-xs font-medium text-red-600 hover:text-red-800 px-2">Remove</button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-1.5 text-center">⌘↵ to save · Esc to cancel</p>
          </div>
        </>
      )}
    </div>
  )
}

// Shape of the application as returned by the reviewer.application.$id loader
export interface ApplicationViewerProps {
  application: {
    answers: unknown
    generalChallengeVersion: { questions: unknown; description?: unknown } | null
    domainApplications: Array<{
      id: string
      answers: unknown
      challengeVersion: {
        questions: unknown
        description?: unknown
        domain: { name: string }
        challenge: { name: string }
      }
    }>
  }
  questionLabels: Record<string, string>
  initialAnnotations?: object[]
  onAnnotationsChange?: (annotations: object[]) => void
}

export function ApplicationViewer({ application, questionLabels, initialAnnotations, onAnnotationsChange }: ApplicationViewerProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>((initialAnnotations as Annotation[]) ?? [])

  const addAnnotation = (ann: Omit<Annotation, 'id'>) => {
    setAnnotations((prev) => {
      const next = [...prev, { ...ann, id: `ann-${Date.now()}` }]
      onAnnotationsChange?.(next)
      return next
    })
  }

  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    setAnnotations((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
      onAnnotationsChange?.(next)
      return next
    })
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => {
      const next = prev.filter((a) => a.id !== id)
      onAnnotationsChange?.(next)
      return next
    })
  }

  const fieldProps = { annotations, onAddAnnotation: addAnnotation, onUpdateAnnotation: updateAnnotation, onDeleteAnnotation: deleteAnnotation }

  return (
    <div className="space-y-6">
      {/* General answers */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">General Information</h2>
        </div>
        <div className="p-6 space-y-6">
          {!isEmptyDoc(application.generalChallengeVersion?.description) && (
            <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
              <RichTextViewer content={application.generalChallengeVersion!.description} />
            </div>
          )}
          {Object.entries(application.answers as Record<string, unknown>).map(([key, value]) => (
            <div key={key}>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">
                {questionLabels[key] ?? key}
              </h3>
              <AnnotatableField fieldKey={key} value={String(value ?? '')} {...fieldProps} />
            </div>
          ))}
        </div>
      </div>

      {/* Domain challenge answers */}
      {application.domainApplications.map((dapp) => {
        const domainName = dapp.challengeVersion.domain.name
        const challengeQuestions = dapp.challengeVersion.questions as unknown as Question[]
        return (
          <div key={dapp.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">{domainName} Challenge</h2>
            </div>
            <div className="p-6 space-y-6">
              {!isEmptyDoc(dapp.challengeVersion.description) && (
                <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
                  <RichTextViewer content={dapp.challengeVersion.description} />
                </div>
              )}
              {Object.entries(dapp.answers as Record<string, unknown>).map(([key, value]) => {
                const label = challengeQuestions.find((q) => q.key === key)?.data.label ?? questionLabels[key] ?? key
                return (
                  <div key={key}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">{label}</h3>
                    <AnnotatableField fieldKey={`${dapp.id}:${key}`} value={String(value ?? '')} {...fieldProps} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
