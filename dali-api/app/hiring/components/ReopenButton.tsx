import { buttonClasses } from '~/components/ui/Button'

export function ReopenButton({
  canReopen,
  reopening,
  onReopen,
}: {
  canReopen: boolean
  reopening: boolean
  onReopen: () => void
}) {
  if (!canReopen) return null
  return (
    <button onClick={onReopen} disabled={reopening} className={buttonClasses('secondary', 'md')}>
      {reopening ? 'Reopening…' : 'Reopen'}
    </button>
  )
}
