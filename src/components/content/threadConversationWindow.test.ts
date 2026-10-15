import { describe, expect, it } from 'vitest'
import { filterRenderableThreadMessages, historyScrollDirection } from './threadConversationWindow'

describe('thread conversation list helpers', () => {
  it('paginates only toward the edge the reader is moving to', () => {
    expect(historyScrollDirection(400, 150, 1000, 500, 200)).toBe('earlier')
    expect(historyScrollDirection(150, 400, 1000, 500, 200)).toBe('later')
    expect(historyScrollDirection(900, 400, 900, 500, 200)).toBeNull()
    expect(historyScrollDirection(400, 400, 900, 500, 200)).toBeNull()
    expect(historyScrollDirection(400, 300, 1000, 500, 200)).toBeNull()
  })

  it('filters grouped metadata without slicing the loaded conversation', () => {
    const messages = [{ id: 'first' }, { id: 'hidden-command' }, { id: 'middle' }, { id: 'hidden-diff' }, { id: 'last' }]
    expect(filterRenderableThreadMessages(messages, new Set(['hidden-command']), new Set(['hidden-diff'])))
      .toEqual([{ id: 'first' }, { id: 'middle' }, { id: 'last' }])
    expect(messages).toHaveLength(5)
  })
})
