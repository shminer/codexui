import type { ThreadReadResponse } from '../api/appServerDtos.js'
import { normalizeThreadMessagesV2 } from '../api/normalizers/v2.js'
import { projectMessageResources } from '../threadResources.js'
import type { UiMessage } from '../types/codex.js'

export type ThreadHistoryEntry = { turnId: string; item: Record<string, unknown> }

export function readThreadHistoryEntries(value: unknown): ThreadHistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid native item page')
  return value.filter((row): row is ThreadHistoryEntry => row !== null && typeof row === 'object' && typeof row.turnId === 'string' && row.item !== null && typeof row.item === 'object' && typeof row.item.id === 'string')
}

export function normalizeHistoryEntry(entry: ThreadHistoryEntry): UiMessage[] {
  return normalizeThreadMessagesV2({ thread: { turns: [{ id: entry.turnId, status: 'completed', error: null, items: [entry.item] }] } } as unknown as ThreadReadResponse)
    .map((message) => ({ ...message, turnIndex: undefined }))
}

export function projectHistoryResources(entries: ThreadHistoryEntry[], cwd: string) {
  return projectMessageResources(entries.flatMap(normalizeHistoryEntry), cwd)
}
