const APP_SUFFIX = /\s*·\s*DALI OS\s*$/

export function stripAppTitle(raw: string): string {
  return raw.replace(APP_SUFFIX, '').trim() || raw
}
