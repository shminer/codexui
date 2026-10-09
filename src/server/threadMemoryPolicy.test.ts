import { afterEach, expect, it, vi } from 'vitest'
import { commandOutputPage, diagnosticPreview, estimateRetainedBytes, ThreadCacheBudget, ThreadDiagnosticBuffer } from './threadMemoryPolicy'

afterEach(() => vi.useRealTimers())

it('evicts all cache entries for the least recently used thread under the shared limit', () => {
  const removed: string[] = []
  const cache = new ThreadCacheBudget(2, 1024)
  cache.retain('snapshot:a', 'a', 'one', 1000, () => removed.push('snapshot:a'))
  cache.retain('page:a', 'a', 'two', 1000, () => removed.push('page:a'))
  cache.retain('snapshot:b', 'b', 'three', 1000, () => removed.push('snapshot:b'))
  cache.touch('snapshot:b')
  cache.retain('snapshot:c', 'c', 'four', 1000, () => removed.push('snapshot:c'))
  expect(removed).toEqual(['snapshot:a', 'page:a'])
})

it('physically removes expired and oversized values without reading them again', () => {
  vi.useFakeTimers()
  const cache = new ThreadCacheBudget(8, 100)
  const expired = vi.fn()
  const oversized = vi.fn()
  cache.retain('snapshot:a', 'a', 'tiny', 30_000, expired)
  vi.advanceTimersByTime(30_000)
  cache.prune()
  expect(expired).toHaveBeenCalledOnce()
  cache.retain('snapshot:b', 'b', 'large'.repeat(100), 30_000, oversized)
  expect(oversized).toHaveBeenCalledOnce()
})

it('uses the latest access to any cache kind when evicting a whole thread', () => {
  const removed: string[] = []
  const cache = new ThreadCacheBudget(2, 1024)
  cache.retain('page:a', 'a', 'one', 1000, () => removed.push('page:a'))
  cache.retain('snapshot:a', 'a', 'two', 1000, () => removed.push('snapshot:a'))
  cache.retain('snapshot:b', 'b', 'three', 1000, () => removed.push('snapshot:b'))
  cache.touch('snapshot:a')
  cache.retain('snapshot:c', 'c', 'four', 1000, () => removed.push('snapshot:c'))
  expect(removed).toEqual(['snapshot:b'])
})

it('rejects one oversized value without evicting other cached threads', () => {
  const cache = new ThreadCacheBudget(8, 100)
  const small = vi.fn()
  const large = vi.fn()
  cache.retain('snapshot:a', 'a', 'small', 30_000, small)
  cache.retain('snapshot:large', 'large', 'x'.repeat(100), 30_000, large)
  expect(large).toHaveBeenCalledOnce()
  expect(small).not.toHaveBeenCalled()
  cache.clear()
  expect(small).toHaveBeenCalledOnce()
})

it('estimates text without serializing shared or cyclic objects', () => {
  const item: Record<string, unknown> = { output: 'abc' }
  item.self = item
  expect(estimateRetainedBytes(item)).toBeGreaterThan(6)
  expect(estimateRetainedBytes(item)).toBeLessThan(200)
})

it('bounds diagnostic preview and releases old threads and old events', () => {
  vi.useFakeTimers()
  const preview = diagnosticPreview({ threadId: 'a', output: 'x'.repeat(20000) })
  expect(preview.truncated).toBe(true)
  expect((preview.value as { output: string }).output.length).toBeLessThan(16384)
  const buffer = new ThreadDiagnosticBuffer<number>()
  for (let event = 0; event < 200; event += 1) buffer.add('a', event)
  expect(buffer.get('a', 400)).toEqual(Array.from({ length: 128 }, (_, index) => index + 72))
  for (let thread = 0; thread < 8; thread += 1) buffer.add(String(thread), thread)
  expect(buffer.get('a', 1)).toEqual([])
  vi.advanceTimersByTime(5 * 60_000)
  expect(buffer.get('7', 1)).toEqual([])
})

it('keeps turn failure identity ahead of large diagnostic item contents', () => {
  const preview = diagnosticPreview({ threadId: 'thread', turn: { items: [{ text: 'x'.repeat(20000) }], id: 'turn', status: 'failed', error: { message: 'failed' } } })
  expect(preview.value).toMatchObject({ threadId: 'thread', turn: { id: 'turn', status: 'failed', error: { message: 'failed' } } })
  expect(preview.truncated).toBe(true)
})

it('preserves exact UTF-16 code units when copying a truncated diagnostic string', () => {
  const preview = diagnosticPreview('\uD83D\uDE00more', 1)
  expect(preview).toEqual({ value: '\uD83D', truncated: true })
})

it('pages command output without splitting UTF-16 pairs and defaults to the tail', () => {
  expect(commandOutputPage('abcdef', undefined, 2)).toEqual({ text: 'ef', offset: 4, totalLength: 6, nextOffset: null })
  const first = commandOutputPage('a\uD83D\uDE00b', 0, 2)
  expect(first).toEqual({ text: 'a', offset: 0, totalLength: 4, nextOffset: 1 })
  expect(commandOutputPage('a\uD83D\uDE00b', first.nextOffset!, 2).text).toBe('\uD83D\uDE00')
  expect(commandOutputPage('a\uD83D\uDE00b', 2, 2).text).toBe('b')
  expect(commandOutputPage('small', 100, 65536)).toEqual({ text: '', offset: 5, totalLength: 5, nextOffset: null })
})
