import { FileText, HardDrive, Home, Calendar, Mail, type LucideIcon } from 'lucide-react'
import { activeSubtabHref, areaForPath, isPinnedActive } from '~/lib/nav-areas'

function pathnameOf(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

export function tabIcon(url: string): LucideIcon {
  const p = pathnameOf(url)
  if (p === '/') return Home
  if (p === '/calendar' || p.startsWith('/calendar/')) return Calendar
  if (p === '/email' || p.startsWith('/email/')) return Mail
  if (p.startsWith('/documents/')) return FileText
  if (isPinnedActive(url, '/drive', { community: true })) return HardDrive
  const area = areaForPath(url, { community: true })
  if (!area) return FileText
  const href = activeSubtabHref(area, url)
  const exact = area.subtabs.find((t) => t.href === href)
  if (exact) return exact.icon
  const within = area.subtabs
    .filter((t) => p.startsWith(t.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return within?.icon ?? area.icon
}
