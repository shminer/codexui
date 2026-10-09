import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../types/codex'
import { EPHEMERAL_MESSAGE_CHARS, boundedText, previewEphemeralMessage, retainEphemeralMessageWindow } from './ephemeralMessageWindow'
import { estimateMessageTextBytes, ACTIVE_THREAD_TEXT_BUDGET, INACTIVE_THREAD_TEXT_BUDGET } from './threadMessageRetention'

const message = (index: number, text = 'answer'): UiMessage => ({ id: `message-${index}`, role: 'assistant', text, turnId: `turn-${index}`, turnIndex: index })

describe('temporary side window memory limits', () => {
  it('bounds text and materializes a surrogate-safe preview', () => {
    expect(boundedText(`a\uD83D\uDE00b`, 2)).toBe('a')
    const preview = previewEphemeralMessage(message(1, 'x'.repeat(EPHEMERAL_MESSAGE_CHARS + 10)))
    expect(preview.text).toHaveLength(EPHEMERAL_MESSAGE_CHARS)
    expect(preview.textTruncated).toBe(true)
    expect(previewEphemeralMessage(preview).textTruncated).toBe(true)
  })

  it('retains 20 visible or 10 minimized turns and pages in either direction', () => {
    const messages = Array.from({ length: 50 }, (_, index) => message(index))
    expect(retainEphemeralMessageWindow(messages, true).messages.map((row) => row.turnIndex)).toEqual(Array.from({ length: 20 }, (_, index) => index + 30))
    expect(retainEphemeralMessageWindow(messages, false).messages).toHaveLength(10)
    expect(retainEphemeralMessageWindow(messages, true, 'earliest').messages[0]?.turnIndex).toBe(0)
  })

  it('bounds a single huge turn rather than retaining the whole turn', () => {
    const messages = Array.from({ length: 100 }, (_, index) => ({ ...message(index, 'x'.repeat(100_000)), turnId: 'one-huge-turn' }))
    for (const visible of [true, false]) {
      const retained = retainEphemeralMessageWindow(messages, visible)
      const bytes = retained.messages.reduce((sum, row) => sum + estimateMessageTextBytes(row), 0)
      expect(bytes).toBeLessThanOrEqual(visible ? ACTIVE_THREAD_TEXT_BUDGET : INACTIVE_THREAD_TEXT_BUDGET)
      expect(retained.removedOlder).toBe(true)
      expect(retained.messages.at(-1)?.id).toBe('message-99')
    }
  })

  it('bounds tiny-item fanout and drops oversize attachments without retaining raw payloads', () => {
    const messages = Array.from({ length: 2000 }, (_, index) => ({ ...message(index), turnId: 'one' }))
    expect(retainEphemeralMessageWindow(messages, true).messages).toHaveLength(1000)
    const giant = { ...message(1), images: ['x'.repeat(ACTIVE_THREAD_TEXT_BUDGET)], rawPayload: 'secret payload' }
    expect(retainEphemeralMessageWindow([giant], true).messages).toEqual([])
    expect(previewEphemeralMessage(giant).rawPayload).toBeUndefined()
  })
})
