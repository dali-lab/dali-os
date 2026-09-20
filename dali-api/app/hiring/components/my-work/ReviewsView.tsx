import { useState } from 'react'
import { Link, useRevalidator } from 'react-router'
import type { DragEndEvent } from '@dnd-kit/core'
import { KanbanBoard, type KanbanColumn } from '~/components/board/KanbanBoard'
import { Pill } from '~/hiring/components/cycle-setup/SetupCard'
import { RECOMMENDATION_TONES } from '~/hiring/lib/labels'
import { CheckCircle } from 'lucide-react'
import { getReviewStatus, type ReviewStatus } from '~/hiring/lib/review-status'
import { buttonClasses } from '~/components/ui/Button'

// My work → Reviews: the reviewer's assigned written applications across every
// cycle they review on, bucketed by the shared status helper so this view and
// the domain-lead pills agree on what counts as "in progress" vs "not started".
export function ReviewsView({
  reviews,
  showCycle,
}: {
  /** Every review the viewer is assigned, across cycles; each has `cycleName`. */
  reviews: any[]
  /** The viewer reviews on several cycles, so cards say which one. */
  showCycle: boolean
}) {
  const revalidator = useRevalidator()
  const [error, setError] = useState<string | null>(null)

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        You don't have any assigned applications yet. You'll see them here
        once your Domain Lead assigns reviewers.
      </p>
    )
  }

  // Only a submitted review moves by drag: pulling it back out unsubmits it.
  // Submitting goes through the review page, which checks the review is
  // complete (the submit API doesn't), and Pending vs In Progress follows from
  // whether the review has any content, so neither is a drag.
  async function handleDragEnd(event: DragEndEvent) {
    const to = event.over?.id
    const from = (event.active.data.current as { status?: ReviewStatus } | undefined)?.status
    if (!to || to === from) return
    setError(null)
    if (from !== 'submitted') return
    const res = await fetch(`/api/hiring/reviews/${event.active.id}/unsubmit`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? "Couldn't reopen that review.")
      return
    }
    revalidator.revalidate()
  }

  const columns: KanbanColumn<any>[] = COLUMNS.map((col) => {
    const cards = reviews.filter((r) => getReviewStatus(r) === col.status)
    return {
      id: col.status,
      title: <span className="text-sm font-semibold" style={{ color: token(col.token, 'ink') }}>{col.label}</span>,
      cards,
      headerExtra: (
        <span className="rounded-full border border-current/30 px-2 py-0.5 text-xs font-medium tabular-nums">
          {cards.length}
        </span>
      ),
      className: 'flex w-full min-h-[300px] flex-col rounded-os-item bg-os-card md:flex-1',
      headerClassName: 'flex items-center justify-between gap-2 rounded-t-os-item px-3 py-2',
      headerStyle: { background: token(col.token, 'fill'), color: token(col.token, 'ink') },
      listClassName: 'flex flex-1 flex-col gap-2 p-2',
      renderEmpty: () => <p className="py-6 text-center text-sm text-os-grey">{col.empty}</p>,
    }
  })

  return (
    <KanbanBoard
      id="my-reviews"
      columns={columns}
      getCardId={(r) => r.id}
      getCardData={(r) => ({ status: getReviewStatus(r) })}
      draggable
      onDragEnd={handleDragEnd}
      error={error}
      renderCard={(r, { isDragging, dragHandleProps }) => {
        const status = getReviewStatus(r)
        const edge = token(COLUMNS.find((c) => c.status === status)!.token, 'edge')
        return (
          <div {...(status === 'submitted' ? dragHandleProps : {})} className={isDragging ? 'opacity-40' : undefined}>
            <ReviewCard review={r} status={status} edge={edge} cycleName={showCycle ? r.cycleName : undefined} />
          </div>
        )
      }}
    />
  )
}

// Same status tokens (app.css --os-status-*) as the project task board, so a
// column reads the same in both places and in both themes.
const COLUMNS: { status: ReviewStatus; label: string; token: string; empty: string }[] = [
  { status: 'notStarted', label: 'Pending', token: 'todo', empty: 'No pending reviews' },
  { status: 'inProgress', label: 'In Progress', token: 'progress', empty: 'None in progress' },
  { status: 'submitted', label: 'Submitted', token: 'done', empty: 'No submitted reviews' },
]

const token = (name: string, part: 'fill' | 'ink' | 'edge') => `var(--os-status-${name}-${part})`

const ACTION_LABEL: Record<ReviewStatus, string> = {
  notStarted: 'Start review',
  inProgress: 'Continue review',
  submitted: 'View review',
}

function ReviewCard({
  review,
  status,
  edge,
  cycleName,
}: {
  review: any
  status: ReviewStatus
  edge: string
  cycleName?: string
}) {
  const da = review.domainApplication
  const user = da?.application?.user
  const domain = da?.domain ?? da?.challengeVersion?.domain
  const appId = da?.applicationId ?? da?.application?.id

  return (
    // Inline border colour: app.css's unlayered `* { border-color }` outranks
    // Tailwind border-colour utilities (same as the task board's cards).
    <div
      className="flex flex-col gap-2 rounded-os-item border border-l-4 border-transparent bg-os-well p-3"
      style={{ borderLeftColor: edge }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-medium text-foreground">
            {user?.firstName ?? '?'} {user?.lastName ?? ''}
          </h4>
          <p className="text-xs text-os-grey">
            {domain?.name ?? 'Unknown domain'}
            {cycleName && <> · {cycleName}</>}
          </p>
        </div>
        {status === 'submitted' && <CheckCircle className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />}
      </div>
      {status === 'submitted' && review.overallRecommendation && (
        <span className="self-start">
          <Pill dot={RECOMMENDATION_TONES[review.overallRecommendation] ?? 'neutral'}>
            {review.overallRecommendation}
          </Pill>
        </span>
      )}
      {appId && (
        <Link
          to={`/hiring/reviewer/application/${appId}`}
          className={buttonClasses(status === 'submitted' ? 'secondary' : 'primary', 'sm', 'w-full')}
        >
          {ACTION_LABEL[status]}
        </Link>
      )}
    </div>
  )
}
