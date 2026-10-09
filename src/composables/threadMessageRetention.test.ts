import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../types/codex'
import { estimateMessageTextBytes, retainThreadMessageWindow } from './threadMessageRetention'

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

  it('keeps the older end while reading backwards and releases the newer end', () => {
    const retained = retainThreadMessageWindow(turns(30), { maxTurns: 20, maxBytes: 2 * 1024 * 1024, direction: 'earliest' })
    expect(retained.messages.at(-1)?.id).toBe('answer-19')
    expect(retained).toMatchObject({ removedOlder: false, removedNewer: true })
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
