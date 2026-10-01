function stripWindowsDevicePathPrefix(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${trimmed.slice('\\\\?\\UNC\\'.length)}`
  }

  if (trimmed.startsWith('\\\\?\\')) {
    return trimmed.slice('\\\\?\\'.length)
  }

  return trimmed
}

export function normalizePathForUi(value: string): string {
  return stripWindowsDevicePathPrefix(value)
}

function isWindowsLikePath(value: string): boolean {
  return /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\') || value.startsWith('//')
}

export function normalizeFileUrlToPath(value: string): string {
  if (!/^file:/iu.test(value)) return normalizePathForUi(value)
  try {
    const url = new URL(value)
    const path = decodeURIComponent(url.pathname)
    if (url.hostname && url.hostname !== 'localhost') return `//${url.hostname}${path}`
    return path.replace(/^\/([A-Za-z]:\/)/u, '$1')
  } catch {
    return ''
  }
}

export function encodeLocalPathForUrl(value: string): string {
  let path = normalizeFileUrlToPath(value)
  if (isWindowsLikePath(path)) path = path.replace(/\\/gu, '/')
  if (!path.startsWith('/')) path = `/${path}`
  return path.split('/').map(encodeURIComponent).join('/')
}

export function normalizeSkillMarkdownPath(value: string): string {
  let path = normalizePathForUi(value)
  if (!path) return ''
  if (isWindowsLikePath(path)) path = path.replace(/\\/gu, '/')
  return path.endsWith('/SKILL.md') ? path : `${path.replace(/\/+$/u, '')}/SKILL.md`
}

export function isAbsoluteLikePath(value: string): boolean {
  const normalized = normalizePathForUi(value)
  return normalized.startsWith('/') || isWindowsLikePath(normalized)
}

export function normalizePathForComparison(value: string): string {
  const path = normalizePathForUi(value)
  const normalized = path.replace(/[\\/]+/gu, '/')
  return isWindowsLikePath(path) ? normalized.toLowerCase() : normalized
}

export function getPathLeafName(value: string): string {
  const path = normalizePathForUi(value)
  const windowsSeparators = isWindowsLikePath(path) || !path.startsWith('/')
  const normalized = path.replace(windowsSeparators ? /[\\/]+$/u : /\/+$/u, '')
  if (!normalized) return ''

  const separatorIndex = windowsSeparators ? Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\')) : normalized.lastIndexOf('/')
  if (separatorIndex < 0) return normalized
  return normalized.slice(separatorIndex + 1)
}

export function getPathParent(value: string): string {
  const path = normalizePathForUi(value)
  const windowsSeparators = isWindowsLikePath(path) || !path.startsWith('/')
  const root = path.match(/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)|\/)/u)?.[0] ?? ''
  const normalized = path.replace(windowsSeparators ? /[\\/]+$/u : /\/+$/u, '')
  if (!normalized) return root

  if (root && normalized.length <= root.length) return root

  const separatorIndex = windowsSeparators ? Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\')) : normalized.lastIndexOf('/')
  if (root && separatorIndex < root.length) return root
  if (separatorIndex <= 0) return ''
  return normalized.slice(0, separatorIndex)
}

export function toProjectName(value: string): string {
  const leaf = getPathLeafName(value)
  return leaf || normalizePathForUi(value) || 'Projectless'
}

export function isProjectlessChatPath(value: string): boolean {
  const normalized = normalizePathForUi(value).replace(/[\\/]+/gu, '/')
  if (!normalized) return false
  return /(?:^|\/)Documents\/Codex\/\d{4}-\d{2}-\d{2}\/[^/]+$/u.test(normalized)
}
