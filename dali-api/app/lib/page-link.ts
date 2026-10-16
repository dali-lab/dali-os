export const COPY_PAGE_LINK_EVENT = 'dali:copy-page-link'

type LocationLike = { pathname: string; search: string; hash: string }

export function isCopyPageLinkShortcut(e: {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
}): boolean {
  return (
    (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')
  )
}

// The form tab urls are stored in: no `embed` marker, hash kept.
export function cleanTabUrl(input: LocationLike | string): string {
  // The base only makes a relative url parseable; it never reaches the result.
  const parsed =
    typeof input === 'string'
      ? new URL(input, 'http://shell')
      : new URL(input.pathname + input.search + input.hash, 'http://shell')
  parsed.searchParams.delete('embed')
  const query = parsed.searchParams.toString()
  return parsed.pathname + (query ? `?${query}` : '') + parsed.hash
}

export function stripHash(url: string): string {
  const i = url.indexOf('#')
  return i === -1 ? url : url.slice(0, i)
}

export function buildPageLink(input: LocationLike | string, origin: string): string {
  return origin + cleanTabUrl(input)
}

// The desktop shell has no IPC for the page, and WebKit refuses a clipboard
// write that follows a native menu click, so it copies from the dalios:// hop.
export async function writePageLink(url: string, opts: { native?: boolean } = {}): Promise<boolean> {
  if (opts.native) {
    window.location.assign(`dalios://copy?url=${encodeURIComponent(url)}`)
    return true
  }
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}
