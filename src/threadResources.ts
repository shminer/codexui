import type { UiMessage } from './types/codex.js'
import { normalizePathForComparison } from './pathUtils.js'
import { findNextMarkdownLink, getBasename, parseFileReference, parseMarkdownLinkToken, resolveRelativePath } from './fileReferences.js'

export type UiThreadResource = {
  key: string
  label: string
  path: string
  url: string
  kind: 'attachment' | 'file'
  itemId: string
  turnId: string
}

export function mergeThreadResources(previous: UiThreadResource[], incoming: UiThreadResource[]): UiThreadResource[] {
  const resources = new Map(previous.map((resource) => [resource.key, resource]))
  for (const resource of incoming) {
    const existing = resources.get(resource.key)
    resources.set(resource.key, existing ? { ...existing, kind: existing.kind === 'attachment' ? existing.kind : resource.kind } : resource)
  }
  return [...resources.values()]
}

export function projectMessageResources(messages: UiMessage[], cwd: string): UiThreadResource[] {
  const resources: UiThreadResource[] = []
  for (const message of messages) {
    const add = (value: string, label: string, kind: UiThreadResource['kind']) => {
      if (!value || /^(?:data|blob):/iu.test(value)) return
      let input = value
      if (input.startsWith('/codex-local-')) {
        const proxy = new URL(input, 'http://localhost')
        input = proxy.searchParams.get('path') ?? input
      }
      const url = /^https?:\/\//iu.test(input) ? input : ''
      const path = url ? '' : resolveRelativePath(input, cwd)
      if (!path && !url) return
      resources.push({ key: path ? normalizePathForComparison(path) : url, label: label || getBasename(path || url), path, url, kind, itemId: message.id, turnId: message.turnId ?? '' })
    }
    for (const file of message.fileAttachments ?? []) add(file.path, file.label, message.role === 'user' ? 'attachment' : 'file')
    for (const file of message.fileChanges ?? []) add(file.movedToPath || file.path, '', 'file')
    if (message.messageType !== 'imageView' || !message.fileAttachments?.length) {
      for (const image of message.images ?? []) add(image, '', message.role === 'user' ? 'attachment' : 'file')
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue
    let cursor = 0
    while (cursor < message.text.length) {
      const token = findNextMarkdownLink(message.text, cursor)
      if (!token) break
      cursor = token.end
      const link = parseMarkdownLinkToken(token.token)
      const file = link && parseFileReference(link.target)
      if (file) add(file.path, link!.label, 'file')
    }
    for (const match of message.text.matchAll(/```[\s\S]*?```|`([^`\n]+)`/gu)) {
      const file = match[1] ? parseFileReference(match[1]) : null
      if (file) add(file.path, '', 'file')
    }
  }
  return mergeThreadResources([], resources)
}
