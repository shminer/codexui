import { isWindowsLikePath, normalizeFileUrlToPath, normalizePathForUi } from './pathUtils.js'

export { getPathLeafName as getBasename } from './pathUtils.js'

function isFilePath(value: string): boolean {
  if (!value || /[\r\n]/u.test(value)) return false
  if (value.endsWith('/') || value.endsWith('\\')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) return false

  const looksLikeUnixAbsolute = value.startsWith('/')
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')
  const looksLikeRelative = value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute || looksLikeRelative) return true

  const looksLikeBareFilename = /^[A-Za-z0-9._@() -]+\.[A-Za-z0-9]{1,12}$/u.test(value)
  if (looksLikeBareFilename) return true

  // Bare relative paths should look like actual path segments, not arbitrary prose containing "/".
  return /^[A-Za-z0-9._@() -]+(?:[\\/][A-Za-z0-9._@() -]+)+$/u.test(value)
}

export function parseMarkdownLinkToken(value: string): { label: string; target: string } | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(')')) return null
  const labelCloseIndex = trimmed.indexOf(']')
  if (labelCloseIndex <= 1) return null
  if (trimmed[labelCloseIndex + 1] !== '(') return null
  const labelRaw = trimmed.slice(1, labelCloseIndex).trim()
  const targetRaw = trimmed.slice(labelCloseIndex + 2, -1).trim()
  if (labelRaw.includes('\n') || targetRaw.includes('\n')) return null
  const label = trimLinkWrappers(labelRaw).core.trim() || labelRaw
  const target = trimLinkWrappers(targetRaw).core.trim()
  if (!target) return null
  return { label, target }
}

export const findNextMarkdownLink = (
  source: string,
  fromIndex: number,
): { start: number; end: number; token: string } | null => {
  let linkStart = source.indexOf('[', fromIndex)
  while (linkStart >= 0) {
    const labelEnd = source.indexOf(']', linkStart + 1)
    if (labelEnd < 0) return null
    if (source[labelEnd + 1] !== '(') {
      linkStart = source.indexOf('[', linkStart + 1)
      continue
    }

    let depth = 1
    let index = labelEnd + 2
    let hasNewLine = false
    while (index < source.length) {
      const char = source[index]
      if (char === '\n') {
        hasNewLine = true
        break
      }
      if (char === '(') depth += 1
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          const token = source.slice(linkStart, index + 1)
          if (parseMarkdownLinkToken(token)) {
            return { start: linkStart, end: index + 1, token }
          }
          break
        }
      }
      index += 1
    }

    if (hasNewLine) {
      linkStart = source.indexOf('[', linkStart + 1)
      continue
    }
    linkStart = source.indexOf('[', linkStart + 1)
  }
  return null
}

export function normalizePathSeparators(pathValue: string): string {
  const path = normalizePathForUi(pathValue)
  return /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('\\\\') ? path.replace(/\\/gu, '/') : path
}

function inferHomeFromCwd(cwd: string): string {
  const normalized = normalizePathSeparators(cwd)
  const userMatch = normalized.match(/^\/Users\/([^/]+)/u)
  if (userMatch) return `/Users/${userMatch[1]}`
  const homeMatch = normalized.match(/^\/home\/([^/]+)/u)
  if (homeMatch) return `/home/${homeMatch[1]}`
  const windowsMatch = normalized.match(/^[A-Za-z]:\/Users\/[^/]+/iu)
  if (windowsMatch) return windowsMatch[0]
  return ''
}

export function normalizePathDots(pathValue: string, windowsPath = isWindowsLikePath(pathValue)): string {
  const normalized = normalizePathSeparators(pathValue)
  if (!normalized) return normalized

  let root = ''
  let rest = normalized
  const uncMatch = windowsPath ? rest.match(/^\/\/[^/]+\/[^/]+(?:\/|$)/u) : null
  const driveMatch = rest.match(/^([A-Za-z]:)(\/.*)?$/u)
  if (driveMatch) {
    root = `${driveMatch[1]}/`
    rest = (driveMatch[2] ?? '').replace(/^\/+/u, '')
  } else if (uncMatch) {
    root = `${uncMatch[0].replace(/\/+$/u, '')}/`
    rest = rest.slice(uncMatch[0].length)
  } else if (rest.startsWith('/')) {
    root = '/'
    rest = rest.slice(1)
  }

  const parts = rest.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }

  const joined = stack.join('/')
  if (root) return joined ? `${root}${joined}` : root
  return joined || normalized
}

export function resolveRelativePath(pathValue: string, cwd: string): string {
  const path = normalizeFileUrlToPath(pathValue)
  const windowsCwd = isWindowsLikePath(cwd)
  const windowsPath = windowsCwd || isWindowsLikePath(path)
  const normalizedPath = windowsCwd ? normalizePathSeparators(path).replace(/\\/gu, '/') : normalizePathSeparators(path)
  if (!normalizedPath) return ''

  const looksLikeAbsolute = normalizedPath.startsWith('/') || /^[A-Za-z]:\//u.test(normalizedPath)
  if (looksLikeAbsolute) return normalizePathDots(normalizedPath, windowsPath)

  if (normalizedPath.startsWith('~/')) {
    const homeBase = inferHomeFromCwd(cwd)
    if (homeBase) {
      return normalizePathDots(`${homeBase}/${normalizedPath.slice(2)}`, windowsPath)
    }
  }

  const base = normalizePathSeparators(cwd)
  if (!base) return normalizePathDots(normalizedPath, windowsPath)
  return normalizePathDots(`${base.replace(/\/+$/u, '')}/${normalizedPath}`, windowsPath)
}

export function parseFileReference(value: string): { path: string; line: number | null } | null {
  if (!value) return null

  let pathValue = value.trim()
  const wrapped = trimLinkWrappers(pathValue)
  pathValue = wrapped.core.trim()
  let line: number | null = null

  const hashLineMatch = pathValue.match(/^(.*)#L(\d+)(?:C\d+)?$/u)
  if (hashLineMatch) {
    pathValue = hashLineMatch[1]
    line = Number(hashLineMatch[2])
  } else {
    const colonLineMatch = pathValue.match(/^(.*):(\d+)(?::\d+)?$/u)
    if (colonLineMatch) {
      pathValue = colonLineMatch[1]
      line = Number(colonLineMatch[2])
    }
  }

  pathValue = normalizeFileUrlToPath(pathValue)
  if (!isFilePath(pathValue)) return null
  return { path: pathValue, line }
}

export function trimLinkWrappers(value: string): { core: string; leading: string; trailing: string } {
  let core = value
  let leading = ''
  let trailing = ''

  const wrapperPairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '<': '>',
    '"': '"',
    '\'': '\'',
    '`': '`',
    '“': '”',
    '‘': '’',
  }

  while (core.length > 0) {
    const opening = core[0]
    const closing = Object.prototype.hasOwnProperty.call(wrapperPairs, opening) ? wrapperPairs[opening] : ''
    if (!closing || !core.endsWith(closing)) break
    leading += opening
    trailing += closing
    core = core.slice(1, -1)
  }

  return { core, leading, trailing }
}
