import type { UiMessage } from '../types/codex'

export const ACTIVE_THREAD_TURN_LIMIT = 20
export const ACTIVE_THREAD_TEXT_BUDGET = 2 * 1024 * 1024
export const INACTIVE_THREAD_TURN_LIMIT = 10
export const INACTIVE_THREAD_TEXT_BUDGET = 512 * 1024
export const INACTIVE_THREAD_CACHE_LIMIT = 3
export const THREAD_HISTORY_TEXT_BUDGET = 16 * 1024 * 1024
export const THREAD_HISTORY_MESSAGE_LIMIT = 1000

// Admit adjacent complete turns without evicting anything the reader already loaded.
export function admitThreadHistoryPage(
  existing: UiMessage[],
  incoming: UiMessage[],
  direction: 'older' | 'newer',
  orderedTurnIds: string[] = [],
  limits = { maxBytes: THREAD_HISTORY_TEXT_BUDGET, maxMessages: THREAD_HISTORY_MESSAGE_LIMIT },
): { messages: UiMessage[]; turnIds: Set<string>; blocked: boolean; capacityReached: boolean } {
  const byId = new Map(existing.map((message) => [message.id, message]))
  let bytes = [...byId.values()].reduce((total, message) => total + estimateMessageTextBytes(message), 0)
  let count = byId.size
  const groups = new Map<string, Map<string, UiMessage>>(orderedTurnIds.map((id) => [id, new Map()]))
  for (const message of incoming) {
    const key = message.turnId || `message:${message.id}`
    if (!groups.has(key)) groups.set(key, new Map())
    groups.get(key)!.set(message.id, message)
  }
  const entries = [...groups]
  if (direction === 'older') entries.reverse()
  const turnIds = new Set<string>()
  let blocked = false
  for (const [key, group] of entries) {
    let addedBytes = 0
    let addedCount = 0
    for (const message of group.values()) {
      const previous = byId.get(message.id)
      // A stale duplicate may be protected by the snapshot merger; never spend its apparent shrinkage.
      addedBytes += Math.max(0, estimateMessageTextBytes(message) - (previous ? estimateMessageTextBytes(previous) : 0))
      if (!previous) addedCount += 1
    }
    if ((bytes + addedBytes > limits.maxBytes || count + addedCount > limits.maxMessages)
      && (addedBytes > 0 || addedCount > 0)) {
      blocked = true
      break
    }
    bytes += addedBytes
    count += addedCount
    turnIds.add(key)
  }
  return { messages: [...new Map(incoming.map((message) => [message.id, message])).values()]
    .filter((message) => turnIds.has(message.turnId || `message:${message.id}`)), turnIds, blocked,
    capacityReached: blocked || bytes >= limits.maxBytes || count >= limits.maxMessages }
}

export function estimateMessageTextBytes(message: UiMessage): number {
  let chars = message.id.length + message.text.length + (message.rawPayload?.length ?? 0)
  if (message.commandExecution) {
    chars += message.commandExecution.command.length + message.commandExecution.aggregatedOutput.length
  }
  for (const change of message.fileChanges ?? []) chars += change.path.length + change.diff.length
  for (const image of message.images ?? []) chars += image.length
  for (const attachment of message.fileAttachments ?? []) chars += attachment.path.length + attachment.label.length
  for (const step of message.plan?.steps ?? []) chars += step.step.length
  chars += message.plan?.explanation?.length ?? 0
  for (const skill of message.skills ?? []) chars += skill.name.length + skill.path.length
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
  function retainGroup(index: number): boolean {
    const [key, group] = entries[index]
    if (retained.has(key)) return true
    const exceedsBudget = count >= options.maxTurns || bytes + group.bytes > options.maxBytes
    if (exceedsBudget) {
      if (count === 0 && options.keepOversizedTurn !== false) {
        retained.add(key)
        bytes += group.bytes
        count += 1
        oversized = true
      }
      return false
    }
    retained.add(key)
    bytes += group.bytes
    count += 1
    return true
  }

  const step = options.direction === 'latest' ? -1 : 1
  for (let index = step === -1 ? entries.length - 1 : 0; index >= 0 && index < entries.length; index += step) {
    if (!retainGroup(index)) break
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
