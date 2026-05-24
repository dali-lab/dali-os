import { useState, useRef, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import type { Question } from '~/types'
import { RichTextViewer, isEmptyDoc } from '~/components/RichTextViewer'
import { AnswerDisplay } from '~/hiring/components/ApplicationAnswers'

// Question types where the answer is a URL or structured value rather than
// freeform prose. We render these via AnswerDisplay (download links, etc.)
// instead of AnnotatableField — annotating an S3 path or a github URL is
// never useful.
const NON_ANNOTATABLE_TYPES: ReadonlyArray<Question['type']> = [
  'file',
  'github_url',
  'figma_url',
  'drive_url',
  'skills_rating',
]

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
  // Coordinates are relative to the AnnotatableField container so the popover
  // scrolls with the annotated content rather than sticking to the viewport.
  x: number
  y: number
  anchorTop: number
  start: number
  end: number
  fieldKey: string
  annotationId?: string
}

const POPOVER_WIDTH = 256
const POPOVER_ESTIMATED_HEIGHT = 220
const VIEWPORT_MARGIN = 8

// Hover tooltip for existing annotations. Positioned with fixed viewport
// coordinates and clamped so highlights near a screen edge don't clip it.
const TOOLTIP_MAX_WIDTH = 288
const TOOLTIP_ESTIMATED_HEIGHT = 80

function clampPopoverPosition(
  x: number,
  y: number,
  anchorTop: number,
  container: HTMLElement | null,
) {
  // Translate the viewport-edge clamp into container-relative coordinates so
  // the popover stays on-screen at the moment of opening but then moves with
  // the page as the user scrolls.
  const containerRect = container?.getBoundingClientRect()
  const offsetX = containerRect?.left ?? 0
  const offsetY = containerRect?.top ?? 0
  const vw = window.innerWidth
  const vh = window.innerHeight
  const minLeft = VIEWPORT_MARGIN - offsetX
  const maxLeft = vw - POPOVER_WIDTH - VIEWPORT_MARGIN - offsetX
  const left = Math.max(minLeft, Math.min(x - POPOVER_WIDTH / 2, maxLeft))
  const flipsAbove = y + offsetY + POPOVER_ESTIMATED_HEIGHT + VIEWPORT_MARGIN > vh
  const top = flipsAbove
    ? Math.max(VIEWPORT_MARGIN - offsetY, anchorTop - POPOVER_ESTIMATED_HEIGHT - VIEWPORT_MARGIN)
    : y
  return { left, top }
}

const COLOR_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-200 border-b-2 border-yellow-400',
  green: 'bg-green-200 border-b-2 border-green-400',
  red: 'bg-red-200 border-b-2 border-red-400',
  blue: 'bg-blue-200 border-b-2 border-blue-400',
}

const COLOR_OPTIONS: HighlightColor[] = ['yellow', 'green', 'red', 'blue']

interface TooltipPosition {
  left: number
  top?: number
  bottom?: number
  below: boolean
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
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null)
  const ref = useRef<HTMLElement>(null)

  const showTooltip = useCallback(() => {
    if (!ref.current || !ann.comment || ann.id === '__pending__') return
    const rect = ref.current.getBoundingClientRect()
    // Center on the mark, then clamp the center so the bubble (up to
    // TOOLTIP_MAX_WIDTH wide, translated -50%) stays inside the viewport.
    const half = TOOLTIP_MAX_WIDTH / 2
    const left = Math.max(
      VIEWPORT_MARGIN + half,
      Math.min(rect.left + rect.width / 2, window.innerWidth - VIEWPORT_MARGIN - half),
    )
    // Prefer rendering above the mark; flip below when it sits too near the top.
    const fitsAbove = rect.top - VIEWPORT_MARGIN - TOOLTIP_ESTIMATED_HEIGHT >= VIEWPORT_MARGIN
    setTooltip(
      fitsAbove
        ? { left, bottom: window.innerHeight - rect.top + VIEWPORT_MARGIN, below: false }
        : { left, top: rect.bottom + VIEWPORT_MARGIN, below: true },
    )
  }, [ann.comment, ann.id])

  return (
    <span className="inline">
      <mark
        ref={ref}
        className={`cursor-pointer rounded-sm ${COLOR_CLASSES[ann.color]}`}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltip(null)}
        onClick={(e) => {
          e.stopPropagation()
          onAnnotationClick(ann.id, e.clientX, e.clientY)
        }}
      >
        {highlighted}
      </mark>
      {tooltip && (
        <span
          className="fixed z-50 pointer-events-none -translate-x-1/2"
          style={{ left: tooltip.left, top: tooltip.top, bottom: tooltip.bottom, maxWidth: TOOLTIP_MAX_WIDTH }}
        >
          {tooltip.below && <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mb-1" />}
          <span className="block bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-pre-wrap shadow-lg">
            {ann.comment}
          </span>
          {!tooltip.below && <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />}
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
  // When true, existing annotations render and are clickable to read the
  // comment, but no new annotation can be created and the popover has no
  // edit/delete controls. Used by the read-only review viewer.
  readOnly?: boolean
}

function AnnotatableField({
  fieldKey,
  value,
  annotations,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  readOnly = false,
}: AnnotatableFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const [pendingComment, setPendingComment] = useState('')
  const [pendingColor, setPendingColor] = useState<HighlightColor>('yellow')

  const handleMouseUp = useCallback(() => {
    if (readOnly) return
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
    const containerRect = container.getBoundingClientRect()
    setPopover({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.bottom + 8 - containerRect.top,
      anchorTop: rect.top - containerRect.top,
      start,
      end,
      fieldKey,
    })
    setPendingComment('')
    setPendingColor('yellow')
    sel.removeAllRanges()
  }, [fieldKey, readOnly])

  const handleAnnotationClick = useCallback(
    (annotationId: string, x: number, y: number) => {
      const ann = annotations.find((a) => a.id === annotationId)
      if (!ann) return
      const containerRect = containerRef.current?.getBoundingClientRect()
      const offsetX = containerRect?.left ?? 0
      const offsetY = containerRect?.top ?? 0
      setPopover({
        x: x - offsetX,
        y: y + 8 - offsetY,
        anchorTop: y - offsetY,
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
    <div ref={containerRef} className="relative">
      <div onMouseUp={handleMouseUp}
        className="text-base text-foreground whitespace-pre-wrap leading-relaxed select-text cursor-text">
        {renderAnnotatedText(value, fieldKey, annotations, handleAnnotationClick,
          popover && !popover.annotationId ? { start: popover.start, end: popover.end, color: pendingColor } : undefined)}
      </div>

      {popover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
          <div
            className="absolute z-50 bg-card rounded-xl shadow-xl border border-border p-3 w-64 max-w-[calc(100vw-2rem)]"
            style={clampPopoverPosition(popover.x, popover.y, popover.anchorTop, containerRef.current)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {readOnly ? 'Annotation' : popover.annotationId ? 'Edit annotation' : 'Add annotation'}
              </span>
              <button onClick={() => setPopover(null)} className="text-muted-foreground/70 hover:text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {readOnly ? (
              pendingComment ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{pendingComment}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Highlighted, no comment.</p>
              )
            ) : (
              <>
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
                  <button onClick={handleSave} className="flex-1 text-xs font-medium bg-accent-coral text-white rounded-lg py-1.5 hover:bg-accent-coral/90">
                    {popover.annotationId ? 'Update' : 'Highlight'}
                  </button>
                  {popover.annotationId && (
                    <button onClick={handleDelete} className="text-xs font-medium text-red-600 hover:text-red-800 px-2">Remove</button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-1.5 text-center">⌘↵ to save · Esc to cancel</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Shape of the application as returned by the reviewer.application.$id loader.
// On InternToFull cycles, `challengeVersion` is null and the domain is loaded
// directly via the `domain` relation instead.
export interface ApplicationViewerProps {
  application: {
    answers: unknown
    generalChallengeVersion: { questions: unknown; description?: unknown } | null
    domainApplications: Array<{
      id: string
      answers: unknown
      challengeVersion?: {
        questions: unknown
        description?: unknown
        domain: { name: string; displayName?: string }
        challenge?: { name: string }
      } | null
      domain?: { name: string; displayName?: string } | null
    }>
  }
  questionLabels: Record<string, string>
  initialAnnotations?: object[]
  onAnnotationsChange?: (annotations: object[]) => void
  // Read-only mode: render annotations but disallow creating / editing /
  // deleting them. Used to display another reviewer's review.
  readOnly?: boolean
}

function buildQuestionMap(questions: Question[]): Record<string, Question> {
  const map: Record<string, Question> = {}
  for (const q of questions) map[q.key] = q
  return map
}

export function ApplicationViewer({ application, questionLabels, initialAnnotations, onAnnotationsChange, readOnly = false }: ApplicationViewerProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>((initialAnnotations as Annotation[]) ?? [])

  // Re-sync when the parent swaps the annotation set (e.g. selecting a
  // different reviewer's review in the read-only viewer).
  useEffect(() => {
    setAnnotations((initialAnnotations as Annotation[]) ?? [])
  }, [initialAnnotations])

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

  const fieldProps = { annotations, onAddAnnotation: addAnnotation, onUpdateAnnotation: updateAnnotation, onDeleteAnnotation: deleteAnnotation, readOnly }

  const generalQuestions =
    (application.generalChallengeVersion?.questions as unknown as Question[] | undefined) ?? []
  const generalQuestionsByKey = buildQuestionMap(generalQuestions)

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
          {Object.entries(application.answers as Record<string, unknown>).map(([key, value]) => {
            const question = generalQuestionsByKey[key]
            const label = question?.data.label ?? questionLabels[key] ?? key
            return (
              <div key={key}>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">{label}</h3>
                {question && NON_ANNOTATABLE_TYPES.includes(question.type) ? (
                  <AnswerDisplay question={question} answer={String(value ?? '')} />
                ) : (
                  <AnnotatableField fieldKey={key} value={String(value ?? '')} {...fieldProps} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Domain challenge answers */}
      {application.domainApplications.map((dapp) => {
        const cv = dapp.challengeVersion
        const directDomain = dapp.domain
        const domainName = cv?.domain.displayName ?? cv?.domain.name ?? directDomain?.displayName ?? directDomain?.name ?? 'Domain'
        if (!cv) {
          // InternToFull domain selection — no challenge content to render.
          return (
            <div key={dapp.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-muted/50">
                <h2 className="text-lg font-semibold text-foreground">{domainName}</h2>
                <p className="text-xs text-muted-foreground mt-1">Target domain selected (no challenge for fellowship applications).</p>
              </div>
            </div>
          )
        }
        const challengeQuestions = cv.questions as unknown as Question[]
        const challengeQuestionsByKey = buildQuestionMap(challengeQuestions)
        return (
          <div key={dapp.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">{domainName} Challenge</h2>
            </div>
            <div className="p-6 space-y-6">
              {!isEmptyDoc(cv.description) && (
                <div className="border border-border rounded-md bg-muted/30 px-4 py-3">
                  <RichTextViewer content={cv.description} />
                </div>
              )}
              {Object.entries(dapp.answers as Record<string, unknown>).map(([key, value]) => {
                const question = challengeQuestionsByKey[key]
                const label = question?.data.label ?? questionLabels[key] ?? key
                return (
                  <div key={key}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">{label}</h3>
                    {question && NON_ANNOTATABLE_TYPES.includes(question.type) ? (
                      <AnswerDisplay question={question} answer={String(value ?? '')} />
                    ) : (
                      <AnnotatableField fieldKey={`${dapp.id}:${key}`} value={String(value ?? '')} {...fieldProps} />
                    )}
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
