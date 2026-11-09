import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PageBarTitleValue } from '~/components/shell/page-bar-slot'

const TITLE_CLASS = 'font-semibold text-foreground'

export function RenameCrumb({ title, onRename }: { title: string; onRename: (name: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const done = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  function finish(save: boolean) {
    if (done.current) return
    done.current = true
    setEditing(false)
    const next = draft.trim()
    if (save && next && next !== title) void onRename(next)
    else setDraft(title)
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label="Rename"
        onClick={() => {
          done.current = false
          setEditing(true)
        }}
        className={`${TITLE_CLASS} min-w-0 truncate rounded px-1 text-left hover:bg-os-hover`}
      >
        {title || 'Untitled'}
      </button>
    )
  }

  return (
    <input
      autoFocus
      aria-label="Page name"
      value={draft}
      placeholder="Untitled"
      size={Math.max(draft.length, 8)}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
      className={`${TITLE_CLASS} min-w-0 max-w-full rounded bg-os-hover px-1 outline-none`}
    />
  )
}

export function TitleCrumbIcon({ title, fallback }: { title: PageBarTitleValue | null; fallback: ReactNode }) {
  if (title?.emoji) return <span aria-hidden>{title.emoji}</span>
  return <>{fallback}</>
}
