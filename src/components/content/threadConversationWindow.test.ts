import { describe, expect, it } from 'vitest'
import {
  clampThreadRenderWindow,
  clampThreadRenderWindowStart,
  earlierThreadRenderWindowStart,
  earlierThreadRenderWindow,
  filterRenderableThreadMessages,
  latestThreadRenderWindowStart,
  laterThreadRenderWindow,
} from './threadConversationWindow'

describe('thread conversation render window', () => {
  it('keeps both history directions bounded and moves at most thirty rows', () => {
    expect(earlierThreadRenderWindow(950, 1000, 1000)).toEqual({ start: 920, end: 1000 })
    expect(earlierThreadRenderWindow(900, 1000, 1000)).toEqual({ start: 870, end: 970 })
    expect(laterThreadRenderWindow(870, 970, 1000)).toEqual({ start: 900, end: 1000 })
  })

  it('does not append new rows into a manual history window', () => {
    expect(clampThreadRenderWindow(100, 200, 10000)).toEqual({ start: 100, end: 200 })
    expect(clampThreadRenderWindow(0, 10000, 10000)).toEqual({ start: 0, end: 100 })
  })

  it('handles an empty or shortened backing page', () => {
    expect(clampThreadRenderWindow(100, 200, 0)).toEqual({ start: 0, end: 0 })
    expect(clampThreadRenderWindow(100, 200, 94)).toEqual({ start: 93, end: 94 })
    expect(laterThreadRenderWindow(0, 0, 0)).toEqual({ start: 0, end: 0 })
  })

  it('clamps a stale oversized start so a non-empty list remains visible', () => {
    expect(clampThreadRenderWindowStart(140, 94)).toBe(93)
  })

  it('uses zero for empty lists and invalid negative starts', () => {
    expect(clampThreadRenderWindowStart(20, 0)).toBe(0)
    expect(clampThreadRenderWindowStart(-4, 10)).toBe(0)
  })

  it('expands from the effective bounded start in one click', () => {
    expect(earlierThreadRenderWindowStart(140, 94)).toBe(63)
  })

  it('keeps the latest render window bounded to fifty messages', () => {
    expect(latestThreadRenderWindowStart(94)).toBe(44)
    expect(latestThreadRenderWindowStart(20)).toBe(0)
  })

  it('keeps a visible anchor when a stale start ends on hidden file-change metadata', () => {
    const messages = [
      { id: 'earlier-visible-anchor' },
      { id: 'hidden-file-change-metadata' },
    ]
    const renderableMessages = filterRenderableThreadMessages(
      messages,
      new Set(['hidden-file-change-metadata']),
    )
    const effectiveStart = clampThreadRenderWindowStart(140, renderableMessages.length)

    expect(renderableMessages.slice(effectiveStart)).toEqual([{ id: 'earlier-visible-anchor' }])
  })
})
