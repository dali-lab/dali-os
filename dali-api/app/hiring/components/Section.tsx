import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'

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
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
          {icon}
          {title}
        </span>
        <div className="flex items-center gap-3">
          {badge}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {open && <div className="p-5 border-t border-gray-200">{children}</div>}
    </div>
  )
}
