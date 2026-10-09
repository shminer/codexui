import { describe, expect, it } from 'vitest'
import { BoundedRenderCache } from './boundedRenderCache'

describe('bounded render cache', () => {
  it('evicts oldest content to stay within the estimated byte budget', () => {
    const cache = new BoundedRenderCache<string, string>(16, 16)
    cache.set('a', '123').set('b', '456').set('c', '789')
    expect([...cache.keys()]).toEqual(['b', 'c'])
    expect(cache.estimatedBytes).toBe(16)
  })

  it('skips oversized entries and releases accounting on replacement and clear', () => {
    const cache = new BoundedRenderCache<string, string>(32, 12)
    cache.set('a', '12345').set('b', '123456')
    expect(cache.has('b')).toBe(false)
    cache.delete('a')
    cache.set('a', '1')
    expect(cache.estimatedBytes).toBe(4)
    cache.clear()
    expect(cache.estimatedBytes).toBe(0)
  })

  it('promotes hits without changing the byte accounting', () => {
    const cache = new BoundedRenderCache<string, string>(16, 16)
    cache.set('a', '123').set('b', '456')
    cache.touch('a')
    cache.set('c', '789')
    expect([...cache.keys()]).toEqual(['a', 'c'])
    expect(cache.estimatedBytes).toBe(16)
  })
})
