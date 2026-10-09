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

export function getThreadPageFocusTurnId(messages: UiMessage[], direction: 'older' | 'newer'): string | undefined {
  const step = direction === 'older' ? -1 : 1
  for (let index = direction === 'older' ? messages.length - 1 : 0; index >= 0 && index < messages.length; index += step) {
    if (messages[index].turnId) return messages[index].turnId
  }
  return undefined
}

export function retainThreadMessageWindow(
  messages: UiMessage[],
  options: {
    maxTurns: number
    maxBytes: number
    direction: 'latest' | 'earliest'
    focusTurnId?: string
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

  const focusIndex = options.focusTurnId && options.keepOversizedTurn !== false
    ? entries.findIndex(([key]) => key === options.focusTurnId) : -1
  if (focusIndex >= 0) {
    // Reach the nearest incoming turn before moving past any budget barrier.
    if (retainGroup(focusIndex)) {
      const step = options.direction === 'earliest' ? -1 : 1
      for (let index = focusIndex + step; index >= 0 && index < entries.length; index += step) {
        if (!retainGroup(index)) break
      }
      for (let index = focusIndex - step; index >= 0 && index < entries.length; index -= step) {
        if (!retainGroup(index)) break
      }
    }
  } else {
    const step = options.direction === 'latest' ? -1 : 1
    for (let index = step === -1 ? entries.length - 1 : 0; index >= 0 && index < entries.length; index += step) {
      if (!retainGroup(index)) break
    }
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
