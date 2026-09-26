import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppServerProcess, BackendQueueProcessor, mutateThreadQueue } from './codexAppServerBridge'

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

describe('queued turn settings', () => {
  it('uses the thread model for a queued turn instead of global defaults', async () => {
    await writeFile(join(reviewHome, '.codex-global-state.json'), JSON.stringify({
      'thread-queue-state': { main: [{ id: 'queued', text: 'continue', imageUrls: [], skills: [], fileAttachments: [], collaborationMode: 'default' }] },
    }))
    const rpc = vi.fn(async (method: string, _params?: any) => {
      if (method === 'thread/read') return { thread: { status: { type: 'idle' }, turns: [] } }
      if (method === 'thread/resume') return { model: 'thread-model', reasoningEffort: 'high' }
      if (method === 'config/read') return { config: { model: 'global-model', model_reasoning_effort: 'medium' } }
      return {}
    })
    processor = new BackendQueueProcessor({ rpc, onNotification: () => () => {} } as any)
    await processor.processThreadQueue('main')
    const start = rpc.mock.calls.find(([method]) => method === 'turn/start')
    expect(start?.[1].collaborationMode.settings.model).toBe('thread-model')
    expect(start?.[1].collaborationMode.settings.reasoning_effort).toBe('high')
    expect(rpc.mock.calls.some(([method]) => method === 'config/read')).toBe(false)
  })
})

it('waits for a pending start before pagehide resolves its active turn', async () => {
  const server = new AppServerProcess()
  vi.spyOn(server as any, 'disposeIfConfigChanged').mockImplementation(() => {})
  vi.spyOn(server as any, 'ensureInitialized').mockResolvedValue(undefined)
  let finish: (value: unknown) => void = () => {}
  vi.spyOn(server as any, 'call').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const start = server.rpc('turn/start', { threadId: 'side' })
  await Promise.resolve()
  let resolved = false
  const active = server.getActiveTurnAfterPendingStarts('side').then(id => { resolved = true; return id })
  await Promise.resolve()
  expect(resolved).toBe(false)
  ;(server as any).emitNotification({ method: 'turn/started', params: { threadId: 'side', turn: { id: 'new-turn' } } })
  ;(server as any).emitNotification({ method: 'turn/completed', params: { threadId: 'side', turn: { id: 'old-turn' } } })
  finish({ turn: { id: 'new-turn' } })
  await start
  expect(await active).toBe('new-turn')
  ;(server as any).emitNotification({ method: 'turn/completed', params: { threadId: 'side', turn: { id: 'new-turn' } } })
  expect(await server.getActiveTurnAfterPendingStarts('side')).toBe('')
})

it('does not start or reschedule a queue after disposal during a metadata read', async () => {
  await mutateThreadQueue('main', { type: 'add', message: { id: 'a', text: 'task' } })
  let finish: (value: unknown) => void = () => {}
  let startedRead: () => void = () => {}
  const reading = new Promise<void>(resolve => { startedRead = resolve })
  const rpc = vi.fn(() => new Promise(resolve => { finish = resolve; startedRead() }))
  processor = new BackendQueueProcessor({ rpc, onNotification: () => () => {} } as any)
  const drain = processor.processThreadQueue('main')
  await reading
  processor.dispose()
  finish({ thread: { status: { type: 'idle' }, turns: [] } })
  await drain
  expect(rpc).toHaveBeenCalledTimes(1)
  const current = await mutateThreadQueue('main', { type: 'move', id: 'missing', targetId: 'a' })
  expect(current.data.main?.map(message => message.id)).toEqual(['a'])
})
