import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../types/codex'
import { ACTIVE_THREAD_TEXT_BUDGET, estimateMessageTextBytes, getThreadPageFocusTurnId, retainThreadMessageWindow } from './threadMessageRetention'

function turns(count: number): UiMessage[] {
  return Array.from({ length: count }, (_, index) => [
    { id: `user-${index}`, role: 'user' as const, text: 'Question', turnId: `turn-${index}`, turnIndex: index },
    { id: `answer-${index}`, role: 'assistant' as const, text: 'Answer', turnId: `turn-${index}`, turnIndex: index },
  ]).flat()
}

describe('thread message retention', () => {
  it('keeps complete recent turns and the original absolute indexes', () => {
    const retained = retainThreadMessageWindow(turns(30), { maxTurns: 20, maxBytes: 2 * 1024 * 1024, direction: 'latest' })
    expect(retained.messages).toHaveLength(40)
    expect(retained.messages[0]).toMatchObject({ id: 'user-10', turnIndex: 10 })
    expect(retained.messages.at(-1)?.id).toBe('answer-29')
    expect(retained).toMatchObject({ removedOlder: true, removedNewer: false })
  })

  it('retains the latest end of a restored chronological snapshot without sorting by timestamps', () => {
    const messages = turns(22).slice(18 * 2)
    const retained = retainThreadMessageWindow(messages, { maxTurns: 2, maxBytes: ACTIVE_THREAD_TEXT_BUDGET, direction: 'latest' })
    expect(retained.messages.map((message) => message.id)).toEqual(['user-20', 'answer-20', 'user-21', 'answer-21'])
    expect(retained.messages.map((message) => message.turnIndex)).toEqual([20, 20, 21, 21])
    expect(retained).toMatchObject({ removedOlder: true, removedNewer: false })
  })

  it('keeps the older end while reading backwards and releases the newer end', () => {
    const retained = retainThreadMessageWindow(turns(30), { maxTurns: 20, maxBytes: 2 * 1024 * 1024, direction: 'earliest' })
    expect(retained.messages.at(-1)?.id).toBe('answer-19')
    expect(retained).toMatchObject({ removedOlder: false, removedNewer: true })
  })

  it.each([
    { direction: 'earliest' as const, focusTurnId: 'turn-29', start: 20, end: 50, first: 26, last: 45 },
    { direction: 'latest' as const, focusTurnId: 'turn-20', start: 0, end: 30, first: 5, last: 24 },
  ])('stops before an oversized middle turn when paging $direction', ({ direction, focusTurnId, start, end, first, last }) => {
    const messages = turns(50).slice(start * 2, end * 2)
    messages.find((message) => message.id === 'answer-25')!.text = 'x'.repeat(ACTIVE_THREAD_TEXT_BUDGET / 2)
    const retained = retainThreadMessageWindow(messages, { maxTurns: 20, maxBytes: ACTIVE_THREAD_TEXT_BUDGET, direction, focusTurnId })
    expect(retained.messages).toHaveLength(40)
    expect(retained.messages[0]?.id).toBe(`user-${first}`)
    expect(retained.messages.at(-1)?.id).toBe(`answer-${last}`)
    expect(new Set(retained.messages.map((message) => message.turnId)).size).toBe(20)
    expect(retained.messages.every((message) => message.turnId !== 'turn-25')).toBe(true)
    expect(retained).toMatchObject({ removedOlder: true, removedNewer: true, oversized: false })
  })

  it.each(['earliest', 'latest'] as const)('keeps an oversized focused turn alone when paging %s', (direction) => {
    const messages = turns(5)
    messages[5].text = 'x'.repeat(ACTIVE_THREAD_TEXT_BUDGET / 2)
    const retained = retainThreadMessageWindow(messages, {
      maxTurns: 20, maxBytes: ACTIVE_THREAD_TEXT_BUDGET, direction, focusTurnId: 'turn-2',
    })
    expect(retained.messages).toEqual(messages.slice(4, 6))
    expect(retained).toMatchObject({ removedOlder: true, removedNewer: true, oversized: true })
  })

  it.each(['earliest', 'latest'] as const)('preserves inactive retention even with a focus when paging %s', (direction) => {
    const messages = turns(5)
    messages[5].text = 'x'.repeat(1000)
    const options = { maxTurns: 10, maxBytes: 500, direction, keepOversizedTurn: false }
    expect(retainThreadMessageWindow(messages, { ...options, focusTurnId: 'turn-2' })).toEqual(retainThreadMessageWindow(messages, options))
  })

  it('chooses the nearest displayable incoming turn and ignores messages without a turn', () => {
    const metadata: UiMessage = { id: 'metadata', role: 'system', text: '' }
    const messages = [metadata, ...turns(2), metadata]
    expect(getThreadPageFocusTurnId(messages, 'older')).toBe('turn-1')
    expect(getThreadPageFocusTurnId(messages, 'newer')).toBe('turn-0')
    expect(getThreadPageFocusTurnId([], 'older')).toBeUndefined()
    expect(getThreadPageFocusTurnId([metadata], 'newer')).toBeUndefined()
  })

  it('applies the byte budget to command output, image data, and diffs', () => {
    const messages = turns(2)
    messages[3] = {
      ...messages[3],
      images: ['data:image/png;base64,abcd'],
      fileChanges: [{ path: '/tmp/file', operation: 'update', movedToPath: null, diff: '+changed', addedLineCount: 1, removedLineCount: 0 }],
      commandExecution: { command: 'printf hello', cwd: '/tmp', status: 'completed', aggregatedOutput: 'hello', exitCode: 0 },
    }
    const latestBytes = estimateMessageTextBytes(messages[2]) + estimateMessageTextBytes(messages[3])
    const retained = retainThreadMessageWindow(messages, { maxTurns: 20, maxBytes: latestBytes, direction: 'latest' })
    expect(retained.messages.map((message) => message.turnId)).toEqual(['turn-1', 'turn-1'])
  })

  it('keeps a single oversized active turn intact but evicts an oversized inactive turn', () => {
    const messages = turns(3)
    messages[5].text = 'x'.repeat(1000)
    const active = retainThreadMessageWindow(messages, { maxTurns: 20, maxBytes: 500, direction: 'latest' })
    expect(active.messages).toEqual(messages.slice(-2))
    expect(active.oversized).toBe(true)
    const inactive = retainThreadMessageWindow(messages, { maxTurns: 10, maxBytes: 500, direction: 'latest', keepOversizedTurn: false })
    expect(inactive.messages).toEqual([])
  })

  it('does not discard the only copy of an optimistic user message', () => {
    const messages = [...turns(3), { id: 'pending', role: 'user' as const, text: 'Unpersisted', messageType: 'userMessage.optimistic' }]
    const retained = retainThreadMessageWindow(messages, { maxTurns: 2, maxBytes: 1000, direction: 'latest' })
    expect(retained.messages.map((message) => message.id)).toEqual(['user-2', 'answer-2', 'pending'])
  })

  it('reuses the original array when no content is removed', () => {
    const messages = turns(2)
    expect(retainThreadMessageWindow(messages, { maxTurns: 20, maxBytes: 1000, direction: 'latest' }).messages).toBe(messages)
  })
})
