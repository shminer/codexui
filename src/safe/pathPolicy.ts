import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

function isInsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export async function resolveAllowedPath(rawPath: string, allowedRoots: string[]): Promise<string | null> {
  if (!rawPath || !isAbsolute(rawPath) || allowedRoots.length === 0) return null

  let candidate: string
  try {
    candidate = await realpath(resolve(rawPath))
  } catch {
    return null
  }

  for (const root of allowedRoots) {
    try {
      const realRoot = await realpath(resolve(root))
      if (isInsideRoot(candidate, realRoot)) return candidate
    } catch {
      continue
    }
  }

  return null
}
