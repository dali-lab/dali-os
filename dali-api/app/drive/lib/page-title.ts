const APP_NAME = 'DALI OS'

/** The page's own name from a "<page> · <context> · DALI OS" document title; '' for the bare app title. */
export function stripAppTitle(raw: string): string {
  const parts = raw.split('·').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 1 && parts[0] === APP_NAME) return ''
  return parts[0] ?? ''
}
