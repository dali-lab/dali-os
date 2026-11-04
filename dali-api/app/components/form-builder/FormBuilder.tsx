import { Fragment, useState, useEffect, type CSSProperties, type MutableRefObject, type ReactNode } from 'react'
import { Menu, MenuItem, MenuSeparator, Select, Tooltip, InfoTip } from "~/components/ui/floating";
import { extractPlaceholders, placeholder } from "~/lib/template-variables";
import { lintFormText } from "~/forms/lib/form-variables";
import {
  GripVertical,
  Pencil,
  Trash2,
  Save,
  Check,
  Loader2,
  Undo2,
  Redo2,
  Type,
  AlignLeft,
  SquareChevronDown,
  ListChecks,
  Star,
  Github,
  Figma,
  HardDrive,
  Paperclip,
  Database,
  SeparatorHorizontal,
  Text,
  CircleDot,
  Gauge,
  CalendarDays,
  Hash,
  Mail,
  CornerDownRight,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Question } from '~/types'
import { DocEditor } from '~/components/doc'
import { referenceSourceChoices, referenceSourceNeedsTerm } from '~/forms/lib/reference-sources.shared'
import { Checkbox } from '~/components/ui/Checkbox'
import { Segmented } from '~/components/ui/Segmented'
import {
  OP_LABELS,
  canBeSource,
  opsForSource,
  questionNumbers,
  ruleDepths,
  showIfProblems,
  showIfSentence,
  valuesForSource,
  type ShowIf,
} from '~/lib/form-logic'
import { isLayoutOnly } from '~/lib/form-answers'
import { useSharedArray } from '~/components/collab/useSharedCollection'
import { formDraftName } from '~/collab/roomName'
import { useUndoKeys } from '~/hooks/useUndoKeys'
import { SearchInput } from '~/components/ui/SearchInput'
import { useOsChrome } from '~/components/os-chrome'

type QuestionType = Question['type']

// The component library: every type an author can drop onto the canvas, in
// display order. Also the source of the edit form's type picker and the type
// badge on each row.
const COMPONENT_GROUPS: {
  title: string
  items: { type: QuestionType; label: string; icon: LucideIcon }[]
}[] = [
  {
    title: 'Text',
    items: [
      { type: 'text', label: 'Short answer', icon: Type },
      { type: 'textarea', label: 'Long answer', icon: AlignLeft },
      { type: 'number', label: 'Number', icon: Hash },
      { type: 'email', label: 'Email', icon: Mail },
      { type: 'date', label: 'Date', icon: CalendarDays },
    ],
  },
  {
    title: 'Choices',
    items: [
      { type: 'radio', label: 'Multiple choice', icon: CircleDot },
      { type: 'select', label: 'Dropdown', icon: SquareChevronDown },
      { type: 'checkbox', label: 'Checkboxes', icon: ListChecks },
      { type: 'scale', label: '1 to 5 scale', icon: Gauge },
      { type: 'skills_rating', label: 'Skills rating', icon: Star },
      { type: 'reference', label: 'Database list', icon: Database },
    ],
  },
  {
    title: 'Links & files',
    items: [
      { type: 'github_url', label: 'GitHub link', icon: Github },
      { type: 'figma_url', label: 'Figma link', icon: Figma },
      { type: 'drive_url', label: 'Drive link', icon: HardDrive },
      { type: 'file', label: 'File upload', icon: Paperclip },
    ],
  },
  {
    title: 'Layout',
    items: [
      { type: 'info', label: 'Text block', icon: Text },
      { type: 'pageBreak', label: 'Page break', icon: SeparatorHorizontal },
    ],
  },
]

const COMPONENTS = COMPONENT_GROUPS.flatMap((g) => g.items)

const OPTION_TYPES: readonly QuestionType[] = ['select', 'radio', 'checkbox', 'skills_rating']
const OTHER_TYPES: readonly QuestionType[] = ['radio', 'checkbox']
const componentLabel = (type: QuestionType) =>
  COMPONENTS.find((c) => c.type === type)?.label ?? type

// The one pill shape every question/version badge wears, in two tones: the
// accent for what needs attention (Required, Live), neutral for metadata.
export const BADGE = {
  accent: 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-os-accent/15 text-os-accent',
  neutral: 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-os-container text-os-grey',
}

const PALETTE_PREFIX = 'palette:'
const CANVAS_ID = 'canvas'

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
  allowOther?: boolean
  scaleLow?: string
  scaleHigh?: string
  minValue?: number | string
  maxValue?: number | string
  accept?: string
  afterDomains?: boolean
  isGeneralForm?: boolean
  maxWordsEnabled?: boolean
  maxWordsValue?: number | string
  referenceSource?: string
  referenceTermId?: string
  body?: unknown
  showIf?: ShowIf
}

function parseBound(raw: number | string | undefined): number | undefined {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export function buildQuestion(input: BuildQuestionInput): Question {
  const {
    key,
    type,
    required,
    label,
    description,
    optionsText,
    allowOther,
    scaleLow,
    scaleHigh,
    minValue,
    maxValue,
    accept,
    afterDomains,
    isGeneralForm,
    maxWordsEnabled,
    maxWordsValue,
    referenceSource,
    referenceTermId,
    body,
    showIf,
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
      options: OPTION_TYPES.includes(type)
        ? (optionsText ?? '').split('\n').filter((o) => o.trim() !== '')
        : undefined,
      allowOther: OTHER_TYPES.includes(type) && allowOther ? true : undefined,
      scaleLow: type === 'scale' ? scaleLow?.trim() || undefined : undefined,
      scaleHigh: type === 'scale' ? scaleHigh?.trim() || undefined : undefined,
      min: type === 'number' ? parseBound(minValue) : undefined,
      max: type === 'number' ? parseBound(maxValue) : undefined,
      accept: type === 'file' ? accept || undefined : undefined,
      afterDomains: isGeneralForm && afterDomains ? true : undefined,
      maxWords,
      referenceSource:
        type === 'reference' ? referenceSource || undefined : undefined,
      referenceTermId:
        type === 'reference' && referenceSourceNeedsTerm(referenceSource)
          ? referenceTermId || undefined
          : undefined,
      body: type === 'info' ? body : undefined,
      showIf,
    },
  }
}

// Legacy `info` rows stored a plain string; the editor needs blocks.
function infoBodyToBlocks(body: unknown): unknown {
  if (typeof body === 'string') {
    return body.trim() ? [{ type: 'paragraph', content: body }] : undefined
  }
  return body ?? undefined
}

interface FormBuilderTabProps {
  initialQuestions?: Question[]
  initialDescription?: unknown
  // "Save" — persists the in-progress questions. Publishing (freezing them
  // into a version) is the host's own control, read via snapshotRef.
  onSave?: (payload: { questions: Question[]; description: unknown }) => void
  // Live feedback for Save, driven by the host's request state.
  saveStatus?: 'idle' | 'saving' | 'saved'
  onCancel?: () => void
  isGeneralForm?: boolean
  // Offer the checkbox (multi-select) question type. Only the Forms feature
  // passes true — the hiring application pipeline isn't array-answer-aware,
  // so hiring challenge builders don't get the option.
  allowCheckbox?: boolean
  // Terms offered for term-scoped reference sources (e.g. projects active in a
  // chosen term). Empty/omitted when no term picker is needed.
  terms?: { id: string; code: string }[]
  // The staffing slot this form collects for, when it drives one. {{term}} in
  // question text resolves from it, so the editor can show an author what the
  // token reads as — and warn when the form is bound to nothing and the token
  // will reach members as written.
  termBinding?: { label: string; termCode?: string } | null
  // Filled with a reader of the live, unsaved builder state so the host's own
  // controls (the page's Preview button) can act on in-progress edits.
  snapshotRef?: MutableRefObject<(() => { questions: Question[]; description: unknown }) | null>
  // Collab substrate. When both are provided the question list is backed by a
  // Hocuspocus Y.Array room (`form:{formId}:draft`) instead of local state,
  // giving multiplayer + UndoManager support. Omitted by the hiring challenge
  // builder (no structured-collab room for that entity).
  formId?: string
  collabToken?: string | null
  // Question key -> the staffing feature that reads its answer. Those
  // questions are always shown, so they can't take a condition.
  mappedQuestions?: Record<string, string>
}
// A draft can hold malformed entries from earlier collab bugs: empty objects
// and repeated keys (dropped; answers are keyed by question, so a repeat is
// never a real second question) and questions without a key (given a fresh
// one; drafts have no answers keyed to it yet).
export function repairQuestions(questions: Question[]): Question[] {
  const seen = new Set<string>()
  return questions
    .filter((q) => !!q && !!q.data && typeof q.data === 'object')
    .filter((q) => {
      if (typeof q.key !== 'string' || !q.key) return true
      if (seen.has(q.key)) return false
      seen.add(q.key)
      return true
    })
    .map((q, i) => (typeof q.key === 'string' && q.key ? q : { ...q, key: `q-${Date.now()}-${i}` }))
}

export function FormBuilderTab({
  initialQuestions: rawInitialQuestions = [],
  initialDescription,
  onSave,
  saveStatus = 'idle',
  onCancel,
  isGeneralForm = false,
  allowCheckbox = false,
  terms = [],
  snapshotRef,
  formId,
  collabToken,
  termBinding = null,
  mappedQuestions = {},
}: FormBuilderTabProps) {
  const [initialQuestions] = useState(() => repairQuestions(rawInitialQuestions))
  // Local state used when the collab room is unavailable (hiring challenge
  // builder, version-edit without formId/collabToken). Always declared so the
  // hook call count is stable. When collab is active we read/write through the
  // hook instead and this state is unused after mount.
  const [localQuestions, setLocalQuestions] = useState<Question[]>(initialQuestions)

  // Collab substrate: backed by a Hocuspocus Y.Array room (`form:{id}:draft`)
  // when formId + collabToken are provided. When the token is null the provider
  // is never created and `yarray` stays null, so we fall back to localQuestions
  // below. The hook is always called (stable call count) but only active when
  // `collabActive` is true.
  const collabActive = !!(formId && collabToken)
  const roomName = formId ? formDraftName(formId) : 'noop'
  const {
    items: collabQuestions,
    replace: collabReplace,
    push: collabPush,
    remove: collabRemove,
    move: collabMove,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSharedArray<Question>(
    roomName,
    collabActive ? collabToken : null,
    'items',
    initialQuestions,
    'key',
  )
  useUndoKeys({ undo, redo, canUndo, canRedo })

  // Unified question list + mutators: route to the collab surface when active,
  // else to plain React state so the hiring challenge builder keeps working.
  const questions = collabActive ? collabQuestions : localQuestions
  const replaceQuestion = (key: string, next: (q: Question) => Question) => {
    const index = questions.findIndex((q) => q.key === key)
    if (index === -1) return
    if (collabActive) collabReplace(index, next(questions[index]))
    else setLocalQuestions((prev) => prev.map((q) => (q.key === key ? next(q) : q)))
  }
  const pushQuestion = (item: Question) => {
    if (collabActive) collabPush(item)
    else setLocalQuestions((prev) => [...prev, item])
  }
  const removeQuestion = (index: number) => {
    if (collabActive) {
      collabRemove(index)
    } else {
      setLocalQuestions((prev) => prev.filter((_, i) => i !== index))
    }
  }
  const moveQuestion = (from: number, to: number) => {
    if (collabActive) {
      collabMove(from, to)
    } else {
      setLocalQuestions((prev) => {
        const next = [...prev]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return next
      })
    }
  }

  const typeOffered = (type: QuestionType) =>
    type !== 'checkbox' || allowCheckbox || editForm.type === 'checkbox'
  const [description, setDescription] = useState<unknown>(initialDescription ?? null)
  const { formTrigger } = useOsChrome()
  if (snapshotRef) snapshotRef.current = () => ({ questions, description })
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Question>>({})
  const [optionsText, setOptionsText] = useState('')
  const [maxWordsEnabled, setMaxWordsEnabled] = useState(false)
  const [maxWordsValue, setMaxWordsValue] = useState<string>('')
  const [minText, setMinText] = useState('')
  const [maxText, setMaxText] = useState('')
  const [acceptPresets, setAcceptPresets] = useState<Set<string>>(new Set())
  const [acceptCustom, setAcceptCustom] = useState('')
  // Drag-to-reorder via dnd-kit (same idiom as EpicSprintManager / KanbanBoard).
  // The reorder commits once, on drop — no per-move state churn — and the live
  // move is a CSS transform, so long forms stay responsive while dragging.
  // `activeId` only tints sibling borders for the duration of a drag.
  const [activeId, setActiveId] = useState<string | null>(null)
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  // Where a dragged library component would land: before/after a row, or at
  // the end of the canvas. Drives the insertion line while dragging.
  const [dropTarget, setDropTarget] = useState<{ key: string; after: boolean } | 'end' | null>(null)
  // Explicit null/'end' checks: `typeof null` is 'object', and a question
  // saved without a key would otherwise match a null target's `?.key`.
  const dropsAt = (key: string, after: boolean) =>
    dropTarget !== null &&
    dropTarget !== 'end' &&
    dropTarget.key === key &&
    dropTarget.after === after
  const draggingComponent = activeId?.startsWith(PALETTE_PREFIX)
    ? (activeId.slice(PALETTE_PREFIX.length) as QuestionType)
    : null
  // Library drags hit-test by pointer (so the canvas itself is a target when
  // it's empty or below the last row); row reorders ignore the canvas zone.
  const collisionDetection: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith(PALETTE_PREFIX)) {
      const hits = pointerWithin(args)
      const row = hits.find((h) => h.id !== CANVAS_ID)
      return row ? [row] : hits
    }
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => c.id !== CANVAS_ID),
    })
  }
  const resolveDropTarget = ({ active, over }: DragOverEvent | DragEndEvent) => {
    if (!over) return null
    if (over.id === CANVAS_ID) return 'end' as const
    const top = active.rect.current.translated?.top ?? 0
    return { key: String(over.id), after: top > over.rect.top + over.rect.height / 2 }
  }
  const handleDragOver = (event: DragOverEvent) => {
    if (String(event.active.id).startsWith(PALETTE_PREFIX)) {
      setDropTarget(resolveDropTarget(event))
    }
  }
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    setDropTarget(null)
    const { active, over } = event
    if (String(active.id).startsWith(PALETTE_PREFIX)) {
      const target = resolveDropTarget(event)
      if (!target) return
      const type = String(active.id).slice(PALETTE_PREFIX.length) as QuestionType
      if (target === 'end') {
        addComponent(type)
        return
      }
      const idx = questions.findIndex((q) => q.key === target.key)
      addComponent(type, idx === -1 ? undefined : idx + (target.after ? 1 : 0))
      return
    }
    if (!over || active.id === over.id) return
    const from = questions.findIndex((q) => q.key === active.id)
    const to = questions.findIndex((q) => q.key === over.id)
    if (from === -1 || to === -1) return
    // moveQuestion commits to the Y.Array (undo-able) instead of arrayMove on
    // local state; the hook's observer propagates the result back as `items`.
    moveQuestion(from, to)
  }
  const resetEditState = () => {
    setEditingKey(null)
    setEditForm({})
    setOptionsText('')
    setMaxWordsEnabled(false)
    setMaxWordsValue('')
    setMinText('')
    setMaxText('')
    setAcceptPresets(new Set())
    setAcceptCustom('')
  }
  const handleEdit = (q: Question) => {
    setEditingKey(q.key)
    setEditForm(q)
    setOptionsText(q.data.options?.join('\n') || '')
    setMaxWordsEnabled(q.data.maxWords !== undefined)
    setMaxWordsValue(q.data.maxWords !== undefined ? String(q.data.maxWords) : '')
    setMinText(q.data.min !== undefined ? String(q.data.min) : '')
    setMaxText(q.data.max !== undefined ? String(q.data.max) : '')
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
    const idx = questions.findIndex((q) => q.key === key)
    if (idx !== -1) removeQuestion(idx)
    if (editingKey === key) resetEditState()
  }

  // Page breaks are ordinary array items (so dnd reorder + delete already work)
  // but layout-only: edited inline via their own title/subtitle inputs rather
  // than the question edit buffer.
  const updatePageBreak = (key: string, patch: { label?: string; description?: string }) => {
    replaceQuestion(key, (q) => ({ ...q, data: { ...q.data, ...patch } }))
  }
  // Text blocks edit inline too; their body is the whole row.
  const updateInfoBody = (key: string, body: unknown) => {
    replaceQuestion(key, (q) => ({ ...q, data: { ...q.data, body } }))
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
      allowOther: editForm.data?.allowOther,
      scaleLow: editForm.data?.scaleLow,
      scaleHigh: editForm.data?.scaleHigh,
      minValue: minText,
      maxValue: maxText,
      accept: buildAcceptFromPresets(acceptPresets, acceptCustom),
      afterDomains: editForm.data?.afterDomains,
      isGeneralForm,
      maxWordsEnabled,
      maxWordsValue,
      referenceSource: editForm.data?.referenceSource,
      referenceTermId: editForm.data?.referenceTermId,
      body: editForm.data?.body,
      showIf: editForm.data?.showIf,
    })
    replaceQuestion(editForm.key, () => rebuilt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editForm, optionsText, acceptPresets, acceptCustom, maxWordsEnabled, maxWordsValue, minText, maxText])

  // Collapse the inline editor. The data is already in the list (auto-commit),
  // so this just closes the form — no save needed.
  const handleDoneEditing = () => {
    resetEditState()
  }

  // Add a component from the library — appended, or inserted at `index` when
  // dropped between rows. Questions open for inline editing straight away.
  const addComponent = (type: QuestionType, index?: number) => {
    const key = `q-${Date.now()}`
    const item: Question =
      type === 'pageBreak'
        ? { key, type, required: false, data: { label: '', description: '' } }
        : type === 'info'
          ? { key, type, required: false, data: { label: '' } }
          : buildQuestion({ key, type, required: true, label: '', isGeneralForm })
    const end = questions.length
    pushQuestion(item)
    if (index !== undefined && index < end) moveQuestion(end, index)
    if (isLayoutOnly(type)) return
    setEditingKey(key)
    setEditForm({ key, type, required: true, data: { label: '' } })
    setOptionsText('')
    setMaxWordsEnabled(false)
    setMaxWordsValue('')
    setMinText('')
    setMaxText('')
    setAcceptPresets(new Set())
    setAcceptCustom('')
  }
  const numbers = questionNumbers(questions)
  const depths = ruleDepths(questions)
  const problemByKey = new Map(
    showIfProblems(questions, new Map(Object.entries(mappedQuestions))).map((p) => [p.key, p.message]),
  )
  const setRule = (showIf: ShowIf | undefined) =>
    setEditForm({ ...editForm, data: { ...editForm.data!, showIf } })
  const ruleFor = (source: Question): ShowIf => ({
    questionKey: source.key,
    op: opsForSource(source)[0],
    value: valuesForSource(source)[0] ?? '',
  })
  const renderEditForm = () => {
    // Soft lint, shared with the email and signing editors: a token this
    // surface doesn't offer stays literal text, so say so rather than letting
    // an author believe it resolves.
    const labelUnknownVars = lintFormText(editForm.data?.label || "").unknown;
    // {{term}} only resolves through a staffing slot binding. Written on a
    // form that drives no slot, it reaches members verbatim — so say which it
    // is, rather than leaving the author to find out from a filled form.
    const usesTermToken = extractPlaceholders(
      `${editForm.data?.label || ""} ${editForm.data?.description || ""}`,
    ).includes("term");

    return (
      <div className="bg-os-accent/5 border border-os-accent/40 rounded-os-item p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Question Label <span className="os-required-mark">*</span>
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
              className="block w-full"
              placeholder="e.g. What is your major?"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              On a form bound to a staffing slot,{" "}
              <span className="font-mono">{placeholder("term")}</span> fills in
              that cycle's term, so one form can serve every round. Anywhere
              else it stays as written.
            </p>
            {labelUnknownVars.length > 0 && (
              <p className="mt-1 text-xs text-os-amber">
                Not a variable:{" "}
                {labelUnknownVars.map((v) => `{{${v}}}`).join(", ")}. It will
                show to members as written.
              </p>
            )}
            {usesTermToken &&
              (termBinding ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">{placeholder("term")}</span> reads
                  as{" "}
                  <span className="font-medium text-foreground">
                    {termBinding.termCode ?? termBinding.label}
                  </span>{" "}
                  while this form is on {termBinding.label}.
                </p>
              ) : (
                <p className="mt-1 text-xs text-os-amber">
                  This form isn't bound to a staffing slot, so{" "}
                  <span className="font-mono">{placeholder("term")}</span> has
                  no term to fill in and members will see it as written. Bind it
                  on the slot's board, or write the term out.
                </p>
              ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Question Type
            </label>
            <Select
              value={editForm.type || 'text'}
              onChange={(v) =>
                setEditForm({
                  ...editForm,
                  type: v as any,
                })
              }
              options={COMPONENTS.filter(
                (c) => !isLayoutOnly(c.type) && typeOffered(c.type),
              ).map((c) => ({ value: c.type, label: c.label }))}
              buttonClassName={formTrigger}
            />
          </div>

          <div className="flex items-center gap-6 mt-6">
            <span className="flex items-center gap-1">
              <Checkbox
                checked={editForm.required || false}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    required: e.target.checked,
                  })
                }
                label={editForm.data?.showIf ? 'Required when shown' : 'Required field'}
              />
              <InfoTip content="Respondents must answer this question before they can submit. Shown as * in the fill view." />
            </span>
            {isGeneralForm && (
              <Checkbox
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
                label="Show after domain questions"
              />
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
              className="block w-full"
              placeholder="e.g. Keep it under 200 words."
            />
          </div>

          {editForm.type === 'textarea' && (
            <div className="col-span-2 flex flex-wrap items-center gap-3">
              <Checkbox
                checked={maxWordsEnabled}
                onChange={(e) => setMaxWordsEnabled(e.target.checked)}
                label="Limit word count"
              />
              <input
                type="number"
                min={1}
                step={1}
                disabled={!maxWordsEnabled}
                value={maxWordsValue}
                onChange={(e) => setMaxWordsValue(e.target.value)}
                className="w-28 disabled:opacity-50"
                placeholder="e.g. 200"
              />
              <span className="text-xs text-muted-foreground">words</span>
            </div>
          )}

          {(editForm.type === 'select' || editForm.type === 'radio' || editForm.type === 'checkbox') && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Options (One per line)
              </label>
              <textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="block w-full"
                placeholder="Option 1&#10;Option 2&#10;Option 3"
              />
              {editForm.type === 'radio' && (
                <p className="mt-1 text-xs text-muted-foreground">Add at least two options.</p>
              )}
            </div>
          )}

          {editForm.type !== undefined &&
            OTHER_TYPES.includes(editForm.type) && (
            <div className="col-span-2">
              <Checkbox
                checked={editForm.data?.allowOther || false}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    data: { ...editForm.data!, allowOther: e.target.checked },
                  })
                }
                label="Add an Other option"
              />
            </div>
          )}

          {editForm.type === 'scale' && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  1 means (Optional)
                </label>
                <input
                  type="text"
                  value={editForm.data?.scaleLow || ''}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      data: { ...editForm.data!, scaleLow: e.target.value },
                    })
                  }
                  className="block w-full"
                  placeholder="e.g. Not at all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  5 means (Optional)
                </label>
                <input
                  type="text"
                  value={editForm.data?.scaleHigh || ''}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      data: { ...editForm.data!, scaleHigh: e.target.value },
                    })
                  }
                  className="block w-full"
                  placeholder="e.g. Very much"
                />
              </div>
            </>
          )}

          {editForm.type === 'number' && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  Minimum (Optional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={minText}
                  onChange={(e) => setMinText(e.target.value)}
                  className="block w-full"
                  placeholder="e.g. 0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  Maximum (Optional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={maxText}
                  onChange={(e) => setMaxText(e.target.value)}
                  className="block w-full"
                  placeholder="e.g. 100"
                />
              </div>
            </>
          )}

          {editForm.type === 'skills_rating' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Skills (One per line)
              </label>
              <textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="block w-full"
                placeholder="JavaScript&#10;Python&#10;React.js&#10;Figma"
              />
            </div>
          )}

          {editForm.type === 'reference' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Data source
              </label>
              <Select
                value={editForm.data?.referenceSource || ''}
                onChange={(v) =>
                  setEditForm({
                    ...editForm,
                    data: {
                      ...editForm.data!,
                      referenceSource: v,
                    },
                  })
                }
                placeholder="Select a source…"
                options={referenceSourceChoices().map((s) => ({ value: s.key, label: s.label }))}
                buttonClassName={formTrigger}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Choices are pulled live when the form is filled, e.g. projects
                open for staffing this term.
              </p>

              {referenceSourceNeedsTerm(editForm.data?.referenceSource) && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Term
                  </label>
                  <Select
                    value={editForm.data?.referenceTermId || ''}
                    onChange={(v) =>
                      setEditForm({
                        ...editForm,
                        data: {
                          ...editForm.data!,
                          referenceTermId: v || undefined,
                        },
                      })
                    }
                    placeholder="Select a term…"
                    options={terms.map((t) => ({ value: t.id, label: t.code }))}
                    buttonClassName={formTrigger}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Projects whose term set includes this term will be listed.
                  </p>
                </div>
              )}
            </div>
          )}

          {editForm.type === 'file' && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground/80 mb-2">
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
                        ? 'bg-os-accent/15 text-os-accent border-os-accent/30'
                        : 'bg-os-well text-os-grey border-os-container hover:border-os-container-hi'
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
                className="block w-full"
                placeholder="Additional types, e.g. .f3z, text/plain"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Toggle common presets above, or enter extra MIME types / extensions below (comma-separated).
              </p>
            </div>
          )}
        </div>

        {editForm.type !== undefined && (() => {
          const own = questions.findIndex((q) => q.key === editForm.key)
          const sources = questions.slice(0, Math.max(own, 0)).filter(canBeSource)
          const rule = editForm.data?.showIf
          const source = rule ? questions.find((q) => q.key === rule.questionKey) : undefined
          const feature = editForm.key ? mappedQuestions[editForm.key] : undefined
          const noSources = sources.length === 0 && !rule
          const problem = editForm.key ? problemByKey.get(editForm.key) : undefined
          return (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground/80">Show this question</span>
                <Segmented
                  ariaLabel="Show this question"
                  size="md"
                  value={rule ? 'when' : 'always'}
                  onChange={(next) =>
                    setRule(next === 'when' && sources[0] ? ruleFor(sources[0]) : undefined)
                  }
                  options={[
                    { value: 'always', label: 'Always' },
                    { value: 'when', label: 'Only when', disabled: !!feature || noSources },
                  ]}
                />
              </div>
              {feature && (
                <p className="text-xs text-muted-foreground">
                  {feature} reads this answer, so the question is always shown.
                </p>
              )}
              {!feature && noSources && (
                <p className="text-xs text-muted-foreground">
                  There is no earlier dropdown, multiple choice, scale or checkbox question to depend on.
                </p>
              )}
              {rule && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <Select
                      value={rule.questionKey}
                      onChange={(key) => {
                        const next = questions.find((q) => q.key === key)
                        if (next) setRule(ruleFor(next))
                      }}
                      placeholder="Pick a question…"
                      options={sources.map((q) => ({
                        value: q.key,
                        label: `Q${numbers.get(q.key)} ${q.data.label || 'Untitled question'}`,
                      }))}
                      buttonClassName={formTrigger}
                    />
                  </div>
                  <div className="w-36 shrink-0">
                    <Select
                      value={rule.op}
                      onChange={(op) => setRule({ ...rule, op: op as ShowIf['op'] })}
                      options={(source ? opsForSource(source) : [rule.op]).map((op) => ({
                        value: op,
                        label: OP_LABELS[op],
                      }))}
                      buttonClassName={formTrigger}
                    />
                  </div>
                  <div className="w-44 shrink-0">
                    <Select
                      value={rule.value}
                      onChange={(value) => setRule({ ...rule, value })}
                      placeholder="Pick an answer…"
                      options={(source ? valuesForSource(source) : []).map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      buttonClassName={formTrigger}
                    />
                  </div>
                </div>
              )}
              {problem && <p className="text-xs text-os-amber">{problem}</p>}
            </div>
          )
        })()}

        <div className="flex justify-between items-center gap-3 pt-2">
          <Tooltip content="Remove question">
            <button
              type="button"
              onClick={() => editForm.key && handleDelete(editForm.key)}
              aria-label="Remove question"
              className="inline-flex items-center justify-center p-1.5 rounded-md text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <button
            onClick={handleDoneEditing}
            className="os-btn-primary os-btn-primary--sm"
          >
            Done
          </button>
        </div>
      </div>
    )
  }
  const busy = saveStatus === 'saving'
  const insertionLine = <div className="h-0.5 rounded-full bg-os-accent" />
  return (
    <DndContext
      sensors={dragSensors}
      collisionDetection={collisionDetection}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setDropTarget(null)
      }}
    >
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <ComponentLibrary allowCheckbox={allowCheckbox} onAdd={addComponent} />

        <CanvasDropZone>
          {/* Block JSON from here on: onChange hands back the BlockNote block
              tree, and that's what drafts/versions persist. Callers pass
              loader-normalized blocks as initialDescription. */}
          <DocEditor
            features="notes"
            density="compact"
            aiEnabled
            initialContent={initialDescription ?? undefined}
            onChange={setDescription}
            placeholder="Describe this form…"
            className="rounded-os-item bg-os-well py-2"
          />
          <div className="space-y-2">
            <SortableContext
              items={questions.map((q) => q.key)}
              strategy={verticalListSortingStrategy}
            >
              {questions.map((q, index) => (
                <SortableQuestionRow key={q.key} id={q.key} disabled={editingKey === q.key}>
                  {(dragHandleProps, isDragging) => (
                    <div
                      className={`relative space-y-2 ${isDragging ? 'opacity-40' : ''}`}
                      style={(depths.get(q.key) ?? 0) > 0 ? { marginLeft: (depths.get(q.key) ?? 0) * 32 } : undefined}
                    >
                      {(depths.get(q.key) ?? 0) > 0 && (
                        <CornerDownRight aria-hidden className="absolute -left-7 top-4 w-[18px] h-[18px] text-os-accent" />
                      )}
                      {dropsAt(q.key, false) && insertionLine}
                      {q.type === 'info' ? (
                        <div
                          data-testid="info-row"
                          className={`flex items-start gap-4 p-4 rounded-os-item border border-dashed group transition-colors duration-150 ${activeId ? 'border-os-container' : 'border-os-container-hi'}`}
                        >
                          <div
                            {...dragHandleProps}
                            aria-label="Reorder text block"
                            className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-muted-foreground select-none touch-none dnd-touch-handle"
                          >
                            <GripVertical className="w-5 h-5" />
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Text block
                              <InfoTip content="Prose shown to respondents at this point in the form. Layout only. Not counted as a question or included in responses." />
                            </div>
                            <DocEditor
                              features="notes"
                              density="compact"
                              initialContent={infoBodyToBlocks(q.data.body)}
                              onChange={(blocks) => updateInfoBody(q.key, blocks)}
                              placeholder="Write something for respondents to read…"
                              className="rounded-os-item bg-os-well py-2"
                            />
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleDelete(q.key)}
                              aria-label="Remove text block"
                              className="p-1.5 text-muted-foreground/70 hover:text-destructive rounded-md hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : q.type === 'pageBreak' ? (
                        <div
                          className={`flex items-start gap-4 p-4 rounded-os-item border border-dashed group transition-colors duration-150 ${activeId ? 'border-os-container' : 'border-os-container-hi'}`}
                        >
                          <div
                            {...dragHandleProps}
                            aria-label="Reorder page break"
                            className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-muted-foreground select-none touch-none dnd-touch-handle"
                          >
                            <GripVertical className="w-5 h-5" />
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <span className="flex-1 border-t border-dashed border-os-container-hi" />
                              <span className="flex items-center gap-1">
                                Page break
                                <InfoTip content="Splits the form into multiple pages at this point. Layout only. Not counted as a question or included in responses." />
                              </span>
                              <span className="flex-1 border-t border-dashed border-os-container-hi" />
                            </div>
                            <input
                              type="text"
                              value={q.data.label || ''}
                              onChange={(e) => updatePageBreak(q.key, { label: e.target.value })}
                              className="block w-full"
                              placeholder="Section title (optional)"
                            />
                            <input
                              type="text"
                              value={q.data.description || ''}
                              onChange={(e) => updatePageBreak(q.key, { description: e.target.value })}
                              className="block w-full"
                              placeholder="Subtitle (optional)"
                            />
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleDelete(q.key)}
                              aria-label="Remove page break"
                              className="p-1.5 text-muted-foreground/70 hover:text-destructive rounded-md hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : editingKey === q.key ? (
                        renderEditForm()
                      ) : (
                        <div
                          onClick={() => handleEdit(q)}
                          className={`flex items-start gap-4 p-4 rounded-os-item border cursor-pointer group transition-colors duration-150 hover:border-os-container-hi ${activeId ? 'border-os-container/60' : 'border-os-container'}`}
                        >
                          <div
                            {...dragHandleProps}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Reorder ${q.data.label || 'question'}`}
                            className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-muted-foreground select-none touch-none dnd-touch-handle"
                          >
                            <GripVertical className="w-5 h-5" />
                          </div>

                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1 flex-wrap">
                              <span className="text-sm font-medium text-muted-foreground">
                                Q{questions.slice(0, index + 1).filter((qq) => !isLayoutOnly(qq.type)).length}
                              </span>
                              <h4 className="text-base font-medium text-foreground">
                                {q.data.label || <span className="text-muted-foreground">Untitled question</span>}
                              </h4>
                              {q.required && (
                                <span className={BADGE.accent}>
                                  Required
                                </span>
                              )}
                              {q.data.afterDomains && (
                                <span className={BADGE.neutral}>
                                  After Domains
                                </span>
                              )}
                              {q.type === 'textarea' && q.data.maxWords !== undefined && (
                                <span className={BADGE.neutral}>
                                  Max {q.data.maxWords} words
                                </span>
                              )}
                              <span className={BADGE.neutral}>
                                {componentLabel(q.type)}
                              </span>
                            </div>

                            {q.data.description && (
                              <p className="text-sm text-muted-foreground mb-2">
                                {q.data.description}
                              </p>
                            )}

                            {q.data.showIf && (
                              <p className="text-sm text-os-accent mb-2">
                                Shown when {showIfSentence(q.data.showIf, numbers)}
                              </p>
                            )}
                            {problemByKey.get(q.key) && (
                              <p className="text-sm text-os-amber mb-2">{problemByKey.get(q.key)}</p>
                            )}

                            {OPTION_TYPES.includes(q.type) && q.data.options && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {[...q.data.options, ...(q.data.allowOther ? ['Other'] : [])].map((opt) => (
                                  <span
                                    key={opt}
                                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-os-well text-os-grey border border-os-container"
                                  >
                                    {opt}
                                  </span>
                                ))}
                              </div>
                            )}

                            {q.type === 'file' && q.data.accept && (
                              <p className="text-xs text-muted-foreground mt-1">Accepts: {q.data.accept}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleEdit(q)
                              }}
                              aria-label="Edit question"
                              className="p-1.5 text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-os-container"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(q.key)
                              }}
                              aria-label="Remove question"
                              className="p-1.5 text-muted-foreground/70 hover:text-destructive rounded-md hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                      {dropsAt(q.key, true) && insertionLine}
                    </div>
                  )}
                </SortableQuestionRow>
              ))}
            </SortableContext>
            {dropTarget === 'end' && questions.length > 0 && insertionLine}
            {questions.length === 0 && (
              <div
                className={`py-12 rounded-os-item border-2 border-dashed text-center text-sm transition-colors ${
                  dropTarget === 'end'
                    ? 'border-os-accent text-os-accent bg-os-accent/5'
                    : 'border-os-container text-os-grey'
                }`}
              >
                Drag a component here, or click one to add it
              </div>
            )}
            <AddComponentMenu allowCheckbox={allowCheckbox} onAdd={addComponent} />
          </div>

          <div className="flex justify-end items-center gap-3 pt-4 border-t border-os-container">
            {/* Undo / Redo — only shown when backed by the collab room (formId +
                collabToken), where the Y.UndoManager provides history. */}
            {formId && collabToken && (
              <div className="flex items-center gap-1 mr-auto">
                <Tooltip content="Undo (⌘Z)">
                  <button
                    type="button"
                    onClick={undo}
                    disabled={!canUndo}
                    aria-label="Undo"
                    className="inline-flex items-center justify-center p-1.5 rounded-md text-foreground/70 hover:bg-os-container disabled:opacity-40 disabled:cursor-not-allowed"
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
                    className="inline-flex items-center justify-center p-1.5 rounded-md text-foreground/70 hover:bg-os-container disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
            )}
            {onCancel && (
              <button onClick={onCancel} disabled={busy} className="os-btn-ghost disabled:opacity-50">
                Cancel
              </button>
            )}
            {onSave && (
              <button
                onClick={() => onSave({ questions, description })}
                disabled={busy}
                className="os-btn-primary disabled:opacity-60"
              >
                {saveStatus === 'saving' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                ) : saveStatus === 'saved' ? (
                  <><Check className="w-4 h-4" /> Saved</>
                ) : (
                  <><Save className="w-4 h-4" /> Save</>
                )}
              </button>
            )}
          </div>
        </CanvasDropZone>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingComponent && <ComponentTile type={draggingComponent} overlay />}
      </DragOverlay>
    </DndContext>
  )
}

function offeredGroups(allowCheckbox: boolean, query = '') {
  return COMPONENT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (c) =>
        (c.type !== 'checkbox' || allowCheckbox) &&
        (!query || c.label.toLowerCase().includes(query)),
    ),
  })).filter((g) => g.items.length > 0)
}

export function AddComponentMenu({
  allowCheckbox,
  onAdd,
}: {
  allowCheckbox: boolean
  onAdd: (type: QuestionType) => void
}) {
  const groups = offeredGroups(allowCheckbox)
  return (
    <Menu
      ariaLabel="Add a question"
      trigger={
        <button
          type="button"
          aria-label="Add a question"
          className="flex w-full items-center justify-center gap-2 p-3 rounded-os-item border border-dashed border-os-container-hi text-sm font-medium text-os-grey transition-colors hover:border-os-accent/60 hover:bg-os-accent/5 hover:text-foreground"
        >
          <Plus className="w-4 h-4" />
          Add question
        </button>
      }
    >
      {groups.map((g, i) => (
        <Fragment key={g.title}>
          {i > 0 && <MenuSeparator />}
          {g.items.map((c) => (
            <MenuItem key={c.type} onSelect={() => onAdd(c.type)} label={c.label}>
              <span className="flex items-center gap-2">
                <c.icon className="w-4 h-4 text-os-accent" />
                {c.label}
              </span>
            </MenuItem>
          ))}
        </Fragment>
      ))}
    </Menu>
  )
}

// The left rail: a searchable library of components. Click a tile to append
// it, or drag it onto the canvas to drop it at a position.
function ComponentLibrary({
  allowCheckbox,
  onAdd,
}: {
  allowCheckbox: boolean
  onAdd: (type: QuestionType) => void
}) {
  const { heading } = useOsChrome()
  const [query, setQuery] = useState('')
  const groups = offeredGroups(allowCheckbox, query.trim().toLowerCase())

  return (
    <aside className="w-full lg:w-72 flex-shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-os-card bg-os-card p-4 space-y-5">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search components"
        aria-label="Search components"
        size="sm"
      />
      {groups.map((g) => (
        <div key={g.title} className="space-y-2">
          <span className={heading}>{g.title}</span>
          <div className="grid grid-cols-3 lg:grid-cols-2 gap-2">
            {g.items.map((c) => (
              <ComponentTile key={c.type} type={c.type} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="text-sm text-os-grey text-center py-4">No matching components.</p>
      )}
    </aside>
  )
}

function ComponentTile({
  type,
  onAdd,
  overlay = false,
}: {
  type: QuestionType
  onAdd?: (type: QuestionType) => void
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${type}`,
    disabled: overlay,
  })
  const item = COMPONENTS.find((c) => c.type === type)!
  const Icon = item.icon
  return (
    <button
      type="button"
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : { ...attributes, ...listeners })}
      onClick={() => onAdd?.(type)}
      className={`flex flex-col items-center justify-center gap-2 px-2 py-3 rounded-os-item border text-center text-xs font-medium text-foreground transition-colors touch-none ${
        overlay
          ? 'bg-os-card border-os-accent shadow-[0_12px_32px_var(--color-os-shadow)] cursor-grabbing'
          : `bg-os-well border-os-container hover:border-os-accent/60 hover:bg-os-accent/5 cursor-grab ${isDragging ? 'opacity-40' : ''}`
      }`}
    >
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-os-accent/15 text-os-accent">
        <Icon className="w-4 h-4" />
      </span>
      {item.label}
    </button>
  )
}

// The canvas surface. Also a drop target, so a library component dropped
// below the last row (or onto an empty form) lands at the end.
function CanvasDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: CANVAS_ID })
  return (
    <div ref={setNodeRef} className="os-form flex-1 min-w-0 w-full rounded-os-card bg-os-card p-5 space-y-4">
      {children}
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
