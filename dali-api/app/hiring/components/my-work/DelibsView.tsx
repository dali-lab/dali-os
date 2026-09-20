import { useEffect, useState } from 'react'
import { useRevalidator } from 'react-router'
import { EyeOff, ListOrdered } from 'lucide-react'
import { Section } from '~/hiring/components/Section'
import { Pill } from '~/hiring/components/cycle-setup/SetupCard'
import { ApplicantContextModal } from '~/hiring/components/delibs/ApplicantContextModal'

// My work → Delibs: a live, read-only mirror of the domain lead's delibs
// boards for the reviewer's domains. Only offered while a session is live.
export function DelibsView({
  delibsSessions,
  delibsApplications,
  showCycle,
}: {
  delibsSessions: any[]
  delibsApplications: any[]
  /** Sessions come from several cycles, so each board names its cycle. */
  showCycle: boolean
}) {
  // Poll the loader every 5s so column moves made by the domain lead surface
  // in this mirror without a manual refresh.
  const revalidator = useRevalidator()
  useEffect(() => {
    const t = setInterval(() => {
      if (revalidator.state === 'idle') revalidator.revalidate()
    }, 5000)
    return () => clearInterval(t)
  }, [revalidator])

  // Selected delibs card → opens the same applicant-context modal the domain
  // lead uses. /full-context permits any reviewer with cycle access, so this
  // gives non-leads visibility into all reviews on apps in their domain.
  const [selectedDelibsDaId, setSelectedDelibsDaId] = useState<string | null>(null)

  // Lookup table of every domainApplication referenced in an active delibs
  // session, so we can render per-column cards from columnOrder.
  const delibsAppMap = new Map<string, any>()
  for (const da of delibsApplications) {
    delibsAppMap.set(da.id, da)
  }

  return (
    <>
      <Section
        title="Delibs View"
        icon={<ListOrdered className="w-4 h-4 text-blue-600" />}
        badge={
          (delibsSessions?.length ?? 0) > 0 ? (
            <Pill dot="accent">
              <EyeOff className="w-3 h-3" aria-hidden />
              Live · Read-only
            </Pill>
          ) : null
        }
      >
        {(delibsSessions?.length ?? 0) === 0 ? (
          <p className="text-sm text-os-grey">
            No active deliberations. Once your Domain Lead opens a delibs
            session, you'll see a live, read-only view of the buckets here.
          </p>
        ) : (
          <div className="space-y-8">
            {(delibsSessions as any[]).map((session: any) => (
              <DelibsSessionView
                key={session.id}
                session={session}
                showCycle={showCycle}
                appMap={delibsAppMap}
                onSelect={(daId) => setSelectedDelibsDaId(daId)}
              />
            ))}
          </div>
        )}
      </Section>
      {selectedDelibsDaId && (
        <ApplicantContextModal
          domainApplicationId={selectedDelibsDaId}
          onClose={() => setSelectedDelibsDaId(null)}
        />
      )}
    </>
  )
}

// Every round's columns share one palette (the names don't collide).
// The same status tokens the domain lead's board uses, so the mirror reads
// like the board it mirrors (and survives dark mode).
const COLUMN_TOKENS: Record<string, string> = {
  'No Decision': 'backlog',
  Interview: 'todo',
  Advance: 'todo',
  Accept: 'done',
  Waitlist: 'review',
  Reject: 'cancelled',
}

const token = (name: string, part: 'fill' | 'ink') => `var(--os-status-${name}-${part})`

function DelibsSessionView({
  session,
  showCycle,
  appMap,
  onSelect,
}: {
  session: any
  showCycle: boolean
  appMap: Map<string, any>
  onSelect: (domainApplicationId: string) => void
}) {
  const columnOrder = (session.columnOrder ?? {}) as Record<string, string[]>
  const columns: string[] = session.columns

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground">
          {session.domain?.name ?? 'Domain'} · {session.roundLabel}
          {showCycle && <span className="font-normal text-os-grey"> · {session.cycleName}</span>}
        </h3>
      </div>
      <div
        className={`grid grid-cols-1 gap-4 ${columns.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
      >
        {columns.map((col) => {
          const ids = columnOrder[col] ?? []
          const name = COLUMN_TOKENS[col] ?? 'backlog'
          return (
            <div key={col} className="flex min-h-[160px] flex-col rounded-os-item bg-os-card">
              <div
                className="flex items-center justify-between gap-2 rounded-t-os-item px-3 py-2"
                style={{ background: token(name, 'fill'), color: token(name, 'ink') }}
              >
                <h4 className="text-sm font-semibold">{col}</h4>
                <span className="rounded-full border border-current/30 px-2 py-0.5 text-xs font-medium tabular-nums">
                  {ids.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {ids.map((id, i) => {
                  const da = appMap.get(id)
                  const user = da?.application?.user
                  const label = user ? `${user.firstName} ${user.lastName}` : 'Applicant'
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelect(id)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-os-item bg-os-well p-3 text-left transition hover:brightness-95"
                    >
                      {col === 'Waitlist' && (
                        <span className="w-4 text-xs font-semibold text-os-grey">{i + 1}.</span>
                      )}
                      <span className="text-sm font-medium text-foreground">{label}</span>
                    </button>
                  )
                })}
                {ids.length === 0 && (
                  <p className="py-6 text-center text-sm text-os-grey">Empty</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

