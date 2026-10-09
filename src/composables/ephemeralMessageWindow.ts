import type { UiMessage } from '../types/codex'
import { limitCommandExecutionOutput } from '../commandOutput'
import { ACTIVE_THREAD_TEXT_BUDGET, ACTIVE_THREAD_TURN_LIMIT, INACTIVE_THREAD_TEXT_BUDGET, INACTIVE_THREAD_TURN_LIMIT, estimateMessageTextBytes } from './threadMessageRetention'

export const EPHEMERAL_MESSAGE_CHARS = 256 * 1024
export const EPHEMERAL_REASONING_CHARS = 64 * 1024

export function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text
  let end = limit
  if (/[\uD800-\uDBFF]/u.test(text[end - 1]!) && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--
  return text.slice(0, end).split('').join('')
}

export function previewEphemeralMessage(message: UiMessage, visible = true): UiMessage {
  const limit = message.messageType === 'reasoning' || !visible ? EPHEMERAL_REASONING_CHARS : EPHEMERAL_MESSAGE_CHARS
  const text = boundedText(message.text, limit)
  return {
    ...message,
    text,
    textTruncated: message.textTruncated || text.length < message.text.length,
    rawPayload: undefined,
    commandExecution: message.commandExecution ? limitCommandExecutionOutput(message.commandExecution) : undefined,
  }
}

// Unlike persisted history, even a single huge running turn must fit the side-window budget.
export function retainEphemeralMessageWindow(messages: UiMessage[], visible: boolean, direction: 'latest' | 'earliest' = 'latest', reservedBytes = 0) {
  const preview = messages.map((message) => previewEphemeralMessage(message, visible))
  const maxBytes = Math.max(0, (visible ? ACTIVE_THREAD_TEXT_BUDGET : INACTIVE_THREAD_TEXT_BUDGET) - reservedBytes)
  const maxTurns = visible ? ACTIVE_THREAD_TURN_LIMIT : INACTIVE_THREAD_TURN_LIMIT
  const ids = new Set<string>()
  const turns = new Set<string>()
  let bytes = 0
  const step = direction === 'latest' ? -1 : 1
  for (let index = step < 0 ? preview.length - 1 : 0; index >= 0 && index < preview.length; index += step) {
    const message = preview[index]!
    const turn = message.turnId || message.id
    const size = estimateMessageTextBytes(message) + 2 * ((message.plan?.explanation?.length ?? 0)
      + (message.skills?.reduce((sum, skill) => sum + skill.name.length + skill.path.length, 0) ?? 0))
    if (ids.size >= 1000 || bytes + size > maxBytes || (!turns.has(turn) && turns.size >= maxTurns)) break
    ids.add(message.id)
    turns.add(turn)
    bytes += size
  }
  const retained = preview.filter((message) => ids.has(message.id))
  return { messages: retained, removedOlder: preview.length > 0 && !ids.has(preview[0]!.id), removedNewer: preview.length > 0 && !ids.has(preview.at(-1)!.id) }
}
