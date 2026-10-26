import { useEffect, useRef } from 'react'

/**
 * Hold one EventSource per URL (see lib/sse.server.ts) and call `onEvent` on
 * every `change` or `sync`. The latest `onEvent` is always used, so callers
 * don't need to memoize it. EventSource reconnects on its own.
 */
export function useEventStream(urls: string[], onEvent: () => void): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const key = [...new Set(urls)].sort().join('\n')

  useEffect(() => {
    if (!key) return
    const handler = () => onEventRef.current()
    const sources = key.split('\n').map((url) => {
      const es = new EventSource(url, { withCredentials: true })
      es.addEventListener('change', handler)
      es.addEventListener('sync', handler)
      return es
    })
    return () => {
      for (const es of sources) es.close()
    }
  }, [key])
}
