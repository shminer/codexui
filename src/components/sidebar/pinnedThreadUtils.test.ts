import { describe, expect, it } from 'vitest'
import { loadPinnedThreadSummaryBatches, unpinThreadBeforeArchive, updatePinnedThreadIds } from './pinnedThreadUtils'

describe('updatePinnedThreadIds', () => {
  it('pins only the target and preserves pins outside the visible workspace', () => {
    expect(updatePinnedThreadIds(['visible', 'hidden-workspace'], 'new-pin', true)).toEqual([
      'new-pin',
      'visible',
      'hidden-workspace',
    ])
  })

  it('unpins only the target and preserves every other pin', () => {
    expect(updatePinnedThreadIds(['visible', 'hidden-workspace'], 'visible', false)).toEqual([
      'hidden-workspace',
    ])
  })
})

describe('unpinThreadBeforeArchive', () => {
  it('skips unpin for unpinned threads and propagates pinned-thread results', async () => {
    const calls: string[] = []
    const unpin = async (threadId: string) => {
      calls.push(threadId)
      return threadId === 'pinned-success'
    }

    await expect(unpinThreadBeforeArchive('unpinned', false, unpin)).resolves.toBe(true)
    await expect(unpinThreadBeforeArchive('pinned-failure', true, unpin)).resolves.toBe(false)
    await expect(unpinThreadBeforeArchive('pinned-success', true, unpin)).resolves.toBe(true)
    expect(calls).toEqual(['pinned-failure', 'pinned-success'])
  })
})

describe('loadPinnedThreadSummaryBatches', () => {
  it('keeps a completed batch when a refresh cancels the next batch', async () => {
    let releaseSecondBatch: () => void = () => {}
    const secondBatchGate = new Promise<void>((resolve) => {
      releaseSecondBatch = resolve
    })
    let confirmFirstCommit: () => void = () => {}
    const firstCommit = new Promise<void>((resolve) => {
      confirmFirstCommit = resolve
    })
    const committed: string[][] = []
    let version = 1
    const hydrationVersion = version
    const loading = loadPinnedThreadSummaryBatches(
      Array.from({ length: 21 }, (_, index) => `thread-${index}`),
      20,
      async (threadId) => {
        if (threadId === 'thread-20') await secondBatchGate
        return threadId
      },
      (loaded) => {
        if (version !== hydrationVersion) return false
        committed.push(loaded.map(({ threadId }) => threadId))
        if (committed.length === 1) confirmFirstCommit()
        return true
      },
    )

    await firstCommit
    expect(committed).toEqual([Array.from({ length: 20 }, (_, index) => `thread-${index}`)])

    version += 1
    releaseSecondBatch()
    await loading
    expect(committed).toHaveLength(1)

    await loadPinnedThreadSummaryBatches(['thread-20'], 20, async (threadId) => threadId, (loaded) => {
      committed.push(loaded.map(({ threadId }) => threadId))
      return true
    })
    expect(committed.at(-1)).toEqual(['thread-20'])
  })
})
