import { describe, expect, it } from 'vitest'
import { EphemeralHistoryStore } from './ephemeralHistoryStore'

const limits = { threads: 2, turns: 2, threadBytes: 4096, totalBytes: 6000, ttlMs: 1000 }
function turn(store: EphemeralHistoryStore, threadId: string, id: string, value = 'answer') {
  store.capture('turn/started', { threadId, turn: { id } })
  store.capture('item/completed', { threadId, turnId: id, item: { id: `${id}-reply`, type: 'agentMessage', text: value } })
  store.capture('turn/completed', { threadId, turn: { id, status: 'completed' } })
}

describe('bounded temporary conversation history', () => {
  it('isolates registered children and ignores boundary items without a turn', () => {
    const store = new EphemeralHistoryStore(limits)
    store.register('child')
    expect(store.capture('item/completed', { threadId: 'parent', item: { id: 'parent' } })).toBe(false)
    store.capture('item/completed', { threadId: 'child', item: { id: 'boundary' } })
    turn(store, 'child', 'one')
    expect(store.page('child', '', '', 20).result.thread.turns[0]?.items).toEqual([{ id: 'one-reply', type: 'agentMessage', text: 'answer' }])
  })

  it('pages both ways and rejects evicted anchors and sources', () => {
    const store = new EphemeralHistoryStore(limits)
    store.register('child')
    for (const id of ['one', 'two', 'three']) turn(store, 'child', id)
    expect(store.page('child', '', '', 1)).toMatchObject({ startTurnIndex: 2, hasMoreOlder: true, historyTruncated: true })
    expect(store.page('child', 'three', '', 1).result.thread.turns[0]?.id).toBe('two')
    expect(store.page('child', '', 'two', 1).result.thread.turns[0]?.id).toBe('three')
    expect(() => store.page('child', 'one', '', 1)).toThrow(expect.objectContaining({ status: 409 }))
    expect(() => store.item('child', 'one', 'one-reply')).toThrow(expect.objectContaining({ status: 410 }))
    store.capture('item/completed', { threadId: 'child', turnId: 'one', item: { id: 'late', text: 'old' } })
    expect(store.page('child', '', '', 20).result.thread.turns).toHaveLength(2)
  })

  it('bounds oversized items, deduplicates IDs and expires idle caches', () => {
    let now = 0
    const store = new EphemeralHistoryStore(limits, () => now)
    store.register('child')
    turn(store, 'child', 'one', 'x'.repeat(10000))
    expect(store.stats.bytes).toBeLessThan(4096)
    expect(store.page('child', '', '', 20).result.thread.turns[0]?.items).toEqual([])
    expect(store.page('child', '', '', 20).historyTruncated).toBe(true)
    turn(store, 'child', 'two')
    const bytes = store.stats.bytes
    store.capture('item/completed', { threadId: 'child', turnId: 'two', item: { id: 'two-reply', type: 'agentMessage', text: 'answer' } })
    expect(store.stats.bytes).toBe(bytes)
    now = 1001
    expect(() => store.page('child', '', '', 1)).toThrow(expect.objectContaining({ status: 410 }))
    expect(store.stats).toEqual({ threads: 0, bytes: 0 })
  })

  it('enforces global count/byte limits and clears closed conversations', () => {
    const store = new EphemeralHistoryStore(limits)
    for (const id of ['one', 'two', 'three']) { store.register(id); turn(store, id, 'turn', 'x'.repeat(1200)) }
    expect(store.stats.threads).toBeLessThanOrEqual(2)
    expect(store.stats.bytes).toBeLessThanOrEqual(6000)
    store.remove('three')
    expect(() => store.item('three', 'turn', 'turn-reply')).toThrow()
    store.clear()
    expect(store.stats).toEqual({ threads: 0, bytes: 0 })
  })

  it('does not recreate recently evicted turns and accounts for bounded error metadata', () => {
    const store = new EphemeralHistoryStore(limits)
    store.register('child')
    for (const id of ['one', 'two', 'three']) turn(store, 'child', id)
    store.capture('turn/started', { threadId: 'child', turn: { id: 'one' } })
    expect(store.page('child', '', '', 20).result.thread.turns.map((entry) => entry.id)).toEqual(['two', 'three'])
    store.capture('turn/completed', { threadId: 'child', turn: { id: 'three', error: { message: 'x'.repeat(10000) } } })
    expect(store.stats.bytes).toBeLessThanOrEqual(limits.threadBytes)
    expect(store.page('child', '', '', 20).result.thread.turns.at(-1)?.error).toEqual({ message: 'Turn error exceeded the temporary history preview limit.' })
  })
})
