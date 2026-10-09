import type { UiMessage } from '../types/codex'

export const ACTIVE_THREAD_TURN_LIMIT = 20
export const ACTIVE_THREAD_TEXT_BUDGET = 2 * 1024 * 1024
export const INACTIVE_THREAD_TURN_LIMIT = 10
export const INACTIVE_THREAD_TEXT_BUDGET = 512 * 1024
export const INACTIVE_THREAD_CACHE_LIMIT = 3

export function estimateMessageTextBytes(message: UiMessage): number {
  let chars = message.id.length + message.text.length + (message.rawPayload?.length ?? 0)
  if (message.commandExecution) {
    chars += message.commandExecution.command.length + message.commandExecution.aggregatedOutput.length
  }
  for (const change of message.fileChanges ?? []) chars += change.path.length + change.diff.length
  for (const image of message.images ?? []) chars += image.length
  for (const attachment of message.fileAttachments ?? []) chars += attachment.path.length + attachment.label.length
  for (const step of message.plan?.steps ?? []) chars += step.step.length
  return chars * 2
}

export function retainThreadMessageWindow(
  messages: UiMessage[],
  options: {
    maxTurns: number
    maxBytes: number
    direction: 'latest' | 'earliest'
    protectedTurnIds?: ReadonlySet<string>
    keepOversizedTurn?: boolean
  },
): { messages: UiMessage[]; removedOlder: boolean; removedNewer: boolean; oversized: boolean } {
  const groups = new Map<string, { messages: UiMessage[]; bytes: number; protected: boolean }>()
  for (const message of messages) {
    const key = message.turnId || `message:${message.id}`
    let group = groups.get(key)
    if (!group) {
      group = { messages: [], bytes: 0, protected: options.protectedTurnIds?.has(key) === true }
      groups.set(key, group)
    }
    group.messages.push(message)
    group.bytes += estimateMessageTextBytes(message)
    if (message.messageType?.startsWith('userMessage.optimistic')) group.protected = true
  }

  const entries = [...groups.entries()]
  const ordered = options.direction === 'latest' ? [...entries].reverse() : entries
  const retained = new Set<string>()
  let bytes = 0
  let count = 0
  let oversized = false
  for (const [key, group] of entries) {
    if (!group.protected) continue
    retained.add(key)
    bytes += group.bytes
    count += 1
  }
  for (const [key, group] of ordered) {
    if (retained.has(key)) continue
    const exceedsBudget = count >= options.maxTurns || bytes + group.bytes > options.maxBytes
    if (exceedsBudget) {
      if (count === 0 && options.keepOversizedTurn !== false) {
        retained.add(key)
        bytes += group.bytes
        count += 1
        oversized = true
      }
      // Keep a contiguous window rather than filling gaps with smaller turns.
      break
    }
    retained.add(key)
    bytes += group.bytes
    count += 1
  }

  const firstRetained = entries.findIndex(([key]) => retained.has(key))
  let lastRetained = -1
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (retained.has(entries[index][0])) { lastRetained = index; break }
  }
  const next = retained.size === groups.size
    ? messages
    : messages.filter((message) => retained.has(message.turnId || `message:${message.id}`))
  return {
    messages: next,
    removedOlder: entries.length > 0 && (firstRetained > 0 || firstRetained < 0),
    removedNewer: entries.length > 0 && lastRetained < entries.length - 1,
    oversized: oversized || bytes > options.maxBytes,
  }
}
