import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '~/lib/cn'

// Collapsible titled panel shared by the Reviews and Interviews dashboards.
export function Section({
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-muted/50 px-5 py-3 text-left transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-2 font-heading text-sm font-semibold text-foreground">
          {icon}
          {title}
        </span>
        <div className="flex items-center gap-3">
          {badge}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </div>
      </button>
      {open && <div className="border-t border-border p-5">{children}</div>}
    </div>
  )
}
