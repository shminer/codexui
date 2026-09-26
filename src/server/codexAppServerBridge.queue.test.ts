import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackendQueueProcessor, mutateThreadQueue } from './codexAppServerBridge'

let reviewHome: string
let processor: BackendQueueProcessor | undefined
beforeEach(async () => {
  reviewHome = await mkdtemp(join(tmpdir(), 'codex-review-'))
  vi.stubEnv('CODEX_HOME', reviewHome)
})
afterEach(async () => {
  processor?.dispose()
  processor = undefined
  vi.unstubAllEnvs()
  await rm(reviewHome, { recursive: true, force: true })
})

describe('backend review reproductions', () => {
  it('does not schedule endless retries for an ephemeral thread with no queue', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('ephemeral threads do not support includeTurns'))
    processor = new BackendQueueProcessor({ rpc, onNotification: () => () => {} } as any)
    const schedule = vi.spyOn(processor, 'scheduleThreadQueueDrain')
    await processor.processThreadQueue('ephemeral-with-no-queue')
    expect(schedule).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

})

describe('atomic message queue operations', () => {
  const message = (id: string) => ({ id, text: id, imageUrls: [], skills: [], fileAttachments: [], collaborationMode: 'default' })
  it('preserves concurrent adds and removes without resurrecting stale messages', async () => {
    await Promise.all(['a', 'b', 'c'].map(id => mutateThreadQueue('main', { type: 'add', message: message(id) })))
    await Promise.all(['a', 'b'].map(id => mutateThreadQueue('main', { type: 'remove', id })))
    const moved = await mutateThreadQueue('main', { type: 'move', id: 'a', targetId: 'c' })
    expect(moved.data.main?.map(item => item.id)).toEqual(['c'])
    const claims = await Promise.all([1, 2].map(() => mutateThreadQueue('main', { type: 'remove', id: 'c' })))
    expect(claims.filter(result => result.removed)).toHaveLength(1)
    expect(claims.at(-1)?.data.main).toBeUndefined()
  })
})
