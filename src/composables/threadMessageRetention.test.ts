import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../types/codex'
import { ACTIVE_THREAD_TEXT_BUDGET, admitThreadHistoryPage, estimateMessageTextBytes, retainThreadMessageWindow } from './threadMessageRetention'

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

  it.each(['older', 'newer'] as const)('admits adjacent complete turns without evicting the other end when paging %s', (direction) => {
    const all = turns(5)
    const existing = direction === 'older' ? all.slice(6) : all.slice(0, 4)
    const incoming = direction === 'older' ? all.slice(0, 6) : all.slice(4)
    const nearest = direction === 'older' ? incoming.slice(-2) : incoming.slice(0, 2)
    const maxBytes = [...existing, ...nearest].reduce((sum, message) => sum + estimateMessageTextBytes(message), 0)
    const result = admitThreadHistoryPage(existing, incoming, direction, [], { maxBytes, maxMessages: 1000 })
    expect(result.messages).toEqual(nearest)
    expect(result.blocked).toBe(true)
    expect(existing).toEqual(direction === 'older' ? all.slice(6) : all.slice(0, 4))
  })

  it.each(['older', 'newer'] as const)('pauses at an oversized adjacent turn rather than skipping it when paging %s', (direction) => {
    const all = turns(4)
    const existing = direction === 'older' ? all.slice(6) : all.slice(0, 2)
    const incoming = direction === 'older' ? all.slice(0, 6) : all.slice(2)
    const nearest = direction === 'older' ? incoming.at(-1)! : incoming[0]
    nearest.text = 'x'.repeat(2000)
    const result = admitThreadHistoryPage(existing, incoming, direction, [], { maxBytes: 1000, maxMessages: 1000 })
    expect(result.messages).toEqual([])
    expect(result.blocked).toBe(true)
    expect(result.turnIds.size).toBe(0)
  })

  it('counts unique IDs and admits empty raw turns without losing their cursors', () => {
    const existing = turns(1)
    const result = admitThreadHistoryPage(existing, [...existing, existing[0]], 'newer', ['turn-0', 'turn-1'], {
      maxBytes: 1000, maxMessages: 2,
    })
    expect(result.messages).toEqual(existing)
    expect([...result.turnIds]).toEqual(['turn-0', 'turn-1'])
    expect(result.blocked).toBe(false)
  })

  it('enforces the message cap at whole-turn boundaries', () => {
    const all = turns(501)
    const result = admitThreadHistoryPage(all.slice(0, 998), all.slice(998), 'newer')
    expect(result.messages.map(message => message.id)).toEqual(['user-499', 'answer-499'])
    expect(result.turnIds.has('turn-500')).toBe(false)
    expect(result.blocked).toBe(true)
  })

  it('reports a full cache separately from a partially rejected page', () => {
    const all = turns(2)
    const result = admitThreadHistoryPage(all.slice(0, 2), all.slice(2), 'newer', [], { maxBytes: 1000, maxMessages: 4 })
    expect(result.blocked).toBe(false)
    expect(result.capacityReached).toBe(true)
    expect(result.messages).toEqual(all.slice(2))
  })

  it('keeps an existing window even if it already exceeds the history budget', () => {
    const existing = turns(1)
    const result = admitThreadHistoryPage(existing, turns(2).slice(2), 'newer', [], { maxBytes: 1, maxMessages: 1 })
    expect(result.messages).toEqual([])
    expect(result.blocked).toBe(true)
    expect(existing).toHaveLength(2)
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
