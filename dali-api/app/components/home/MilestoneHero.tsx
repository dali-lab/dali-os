import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import CardBevel from './landing/CardBevel'
import LandingBackground from './landing/backgrounds/LandingBackground'
import type { LandingBackgroundId } from './landing/backgrounds/schedule'
import { useLandingMotion } from './landing/useLandingMotion'
import './landing/landing.css'

export interface RecentCard {
  id: string
  title?: string
  href?: string
  onClick?: () => void
  media?: ReactNode
  /** Rendered beside the card, not inside it, so it can't trigger the card's link. */
  action?: ReactNode
  /** Keep `action` visible; otherwise it only shows on hover/focus. */
  actionPinned?: boolean
}

export interface MilestoneHeroProps {
  weekBadge?: string
  milestoneTitle?: string
  greeting?: string
  userName: string
  recents?: RecentCard[]
  recentsHeading?: string
  /** The search control — the page owns its behavior; see `landing-search-*` for styling. */
  search?: ReactNode
  /** Which art sits behind the content; see landing/backgrounds/schedule.ts. */
  background: LandingBackgroundId
  className?: string
}

/** Milestones landing page: the content column over a swappable animated background. */
export default function MilestoneHero({
  weekBadge,
  milestoneTitle,
  greeting = 'Good afternoon',
  userName,
  recents = [],
  recentsHeading = 'Favorites and Recently Visited',
  search,
  background,
  className,
}: MilestoneHeroProps) {
  const id = useId()
  const cards = padRecents(recents, 4)
  const { ref: rowRef, fade, onScroll } = useEdgeFade<HTMLUListElement>()
  const landingRef = useRef<HTMLElement>(null)
  useLandingMotion(landingRef)

  return (
    <div className="landing-frame">
      <main ref={landingRef} className={joinClasses('landing', className)} data-background={background}>
        <LandingBackground id={background} />

        <div className="landing-content">
          {(weekBadge || milestoneTitle) && (
            <header className="landing-title">
              {weekBadge && <span className="landing-badge landing-glass">{weekBadge}</span>}
              {milestoneTitle && (
                <h1 className="landing-heading">
                  <span className="landing-name">{milestoneTitle}</span>
                </h1>
              )}
            </header>
          )}

          <p className="landing-greeting">
            {greeting}, <span className="landing-greeting-name">{userName}</span>
          </p>

          {search}

          {recents.length > 0 && (
            <section aria-labelledby={`${id}-recents`} className="landing-favorites">
              <h2 id={`${id}-recents`} className="landing-favorites-heading">
                {recentsHeading}
              </h2>
              <ul
                ref={rowRef}
                onScroll={onScroll}
                className="landing-cards"
                data-fade-start={fade.start || undefined}
                data-fade-end={fade.end || undefined}
              >
                {cards.map((card, i) => (
                  <li key={card?.id ?? `placeholder-${i}`}>
                    <RecentCardTile card={card} />
                    {card?.action && (
                      <span className="landing-card-action" data-pinned={card.actionPinned || undefined}>
                        {card.action}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

/* Which ends of a horizontal scroller still hide content, so each side can fade only while
   there is more to scroll to in that direction. */
function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [fade, setFade] = useState({ start: false, end: false })

  const measure = () => {
    const el = ref.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  })

  return { ref, fade, onScroll: measure }
}

function RecentCardTile({ card }: { card: RecentCard | null }) {
  if (!card) {
    return (
      <div aria-hidden="true" className="landing-card landing-glass">
        <CardBevel />
      </div>
    )
  }

  const content = (
    <>
      <CardBevel />
      {card.media ?? <span className="sr-only">{card.title ?? 'Recent item'}</span>}
    </>
  )

  if (card.href) {
    return (
      <a href={card.href} className="landing-card landing-glass" aria-label={card.title}>
        {content}
      </a>
    )
  }

  return (
    <button type="button" onClick={card.onClick} className="landing-card landing-glass" aria-label={card.title}>
      {content}
    </button>
  )
}

/* Short lists are padded to four placeholder tiles so the row keeps its shape; longer ones
   scroll sideways (see .landing-cards). */
function padRecents(items: RecentCard[], count: number): (RecentCard | null)[] {
  if (items.length >= count) return items
  return [...items, ...Array<null>(count - items.length).fill(null)]
}

function joinClasses(...values: (string | undefined | false)[]): string {
  return values.filter(Boolean).join(' ')
}
