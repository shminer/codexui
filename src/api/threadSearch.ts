import { CodexApiError } from './codexErrors'

export function titleMatchRank(title: string, query: string): number {
  const text = title.toLowerCase().replace(/\s/gu, '')
  const needle = query.toLowerCase().replace(/\s/gu, '')
  if (!needle || text.includes(needle)) return 0
  const characters = Array.from(needle)
  let index = 0
  for (const character of text) {
    if (character === characters[index]) index += 1
  }
  return index === characters.length ? 1 : 2
}

export function isNativeHistoryUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error instanceof CodexApiError && (error.code === 'network_error' || error.status === 401 || error.status === 403)) return false
  if (/timeout|timed out|authentication|unauthorized/iu.test(error.message)) return false
  return /method not found|unknown (?:method|variant)|unsupported method|unrecognized method|(?:search|pagination).{0,80}(?:not supported|requires.{0,30}(?:sqlite|storage|state))|(?:sqlite|storage|state db).{0,80}(?:not supported|not enabled|disabled|unavailable)/iu.test(error.message)
}
