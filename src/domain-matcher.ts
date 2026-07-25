import { DomainPattern } from './types'

function isDomainMatch(hostname: string, pattern: string) {
  if (!hostname || !pattern) return false
  if (hostname === pattern) return true
  return hostname.endsWith('.' + pattern)
}

function parseRegex(pattern: string): RegExp | null {
  // allow /pattern/flags syntax or plain pattern
  try {
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      const last = pattern.lastIndexOf('/')
      const body = pattern.slice(1, last)
      const flags = pattern.slice(last + 1)
      return new RegExp(body, flags)
    }
    return new RegExp(pattern)
  } catch (e) {
    return null
  }
}

export function isUrlAllowed(url: string, patterns: DomainPattern[] | undefined | null): boolean {
  if (!patterns || patterns.length === 0) return false
  let href = url || ''
  let hostname = ''
  try {
    const u = new URL(href)
    hostname = u.hostname
    href = u.href
  } catch (e) {
    // invalid URL (chrome://, about:, file:), treat as non-match
    return false
  }

  for (const p of patterns) {
    if (typeof p === 'string') {
      if (isDomainMatch(hostname, p)) return true
      continue
    }
    const { pattern, matchType } = p
    if (!pattern) continue
    if (matchType === 'domain') {
      if (isDomainMatch(hostname, pattern)) return true
    } else if (matchType === 'include') {
      if (href.includes(pattern)) return true
    } else if (matchType === 'regex') {
      const re = parseRegex(pattern)
      if (!re) continue
      if (re.test(href)) return true
    }
  }
  return false
}
