import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppServerProcess, rollbackThreadWithFiles } from './codexAppServerBridge'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'codex-rollback-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

async function setup(content = 'after\n') {
  const file = join(directory, 'example.txt')
  const log = join(directory, 'session.jsonl')
  await writeFile(file, content)
  await writeFile(log, [
    { type: 'turn_context', payload: { turn_id: 'selected' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', status: 'completed', call_id: 'patch-1', input: '*** Begin Patch\n*** Update File: example.txt\n@@\n-before\n+after\n*** End Patch' } },
  ].map(row => JSON.stringify(row)).join('\n'))
  return { file, log }
}

it('leaves real workspace files unchanged if history rollback is rejected', async () => {
  const { file, log } = await setup()
  const rpc = vi.fn(async (method: string) => {
    if (method === 'thread/read') return { thread: { path: log, turns: [{ id: 'selected', status: 'completed' }] } }
    throw new Error('thread/revert unsupported')
  })
  await expect(rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)).rejects.toThrow('unsupported')
  expect(await readFile(file, 'utf8')).toBe('after\n')
})

it('captures patches before rollback removes the selected turns', async () => {
  const { file, log } = await setup()
  const retained = { thread: { turns: [{ id: 'earlier' }] } }
  let reverted = false
  const rpc = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'thread/read') {
      expect(params).toEqual({ threadId: 'thread', includeTurns: true })
      if (!reverted) return { thread: { path: log, turns: [{ id: 'earlier' }, { id: 'selected' }, { id: 'later' }] } }
      expect(await readFile(file, 'utf8')).toBe('before\n')
      return retained
    }
    expect(method).toBe('thread/revert')
    expect(params).toEqual({ threadId: 'thread', beforeTurnId: 'selected' })
    expect(await readFile(file, 'utf8')).toBe('after\n')
    await writeFile(log, '')
    reverted = true
    return { thread: { turns: [] }, turnsBackwardsCursor: 'retained-cursor' }
  })
  const result = await rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)
  expect(result.fileErrors).toEqual([])
  expect(result.result).toEqual(retained)
  expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/revert', 'thread/read'])
  expect(await readFile(file, 'utf8')).toBe('before\n')
})

it('returns partial file failures along with the completed history result', async () => {
  const { file, log } = await setup('external edit\n')
  const rpc = vi.fn()
    .mockResolvedValueOnce({ thread: { path: log, turns: [{ id: 'selected' }] } })
    .mockResolvedValueOnce({ thread: { turns: [] } })
    .mockResolvedValueOnce({ thread: { turns: [] } })
  const result = await rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)
  expect(result.fileErrors).toHaveLength(1)
  expect(result.result).toEqual({ thread: { turns: [] } })
  expect(await readFile(file, 'utf8')).toBe('external edit\n')
})

it('leaves files untouched while a turn is active or the selected turn is missing', async () => {
  const { file, log } = await setup()
  const rpc = vi.fn().mockResolvedValue({ thread: { path: log, turns: [{ id: 'selected', status: 'inProgress' }] } })
  await expect(rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)).rejects.toThrow('Finish the current turn')
  rpc.mockResolvedValue({ thread: { path: log, turns: [{ id: 'different', status: 'completed' }] } })
  await expect(rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)).rejects.toThrow('no longer exists')
  expect(rpc.mock.calls.every(([method]) => method === 'thread/read')).toBe(true)
  expect(await readFile(file, 'utf8')).toBe('after\n')
})

it.each([{ retained: [] }, { retained: [{ id: 'earlier' }] }])('preserves retained turns $retained when the post-revert read fails', async ({ retained }) => {
  const { file, log } = await setup()
  const rpc = vi.fn()
    .mockResolvedValueOnce({ thread: { path: log, turns: [...retained, { id: 'selected' }, { id: 'later' }] } })
    .mockResolvedValueOnce({ thread: { id: 'thread', turns: [] } })
    .mockRejectedValueOnce(new Error('read interrupted'))
  const result = await rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)
  expect(result.result).toEqual({ thread: { id: 'thread', path: log, turns: retained } })
  expect(result.historyError).toContain('retained history could not be reloaded: read interrupted')
  expect(result.fileErrors).toEqual([])
  expect(await readFile(file, 'utf8')).toBe('before\n')
})

it('keeps file conflicts separate from the retained-history warning', async () => {
  const { file, log } = await setup('external edit\n')
  const rpc = vi.fn()
    .mockResolvedValueOnce({ thread: { path: log, turns: [{ id: 'selected' }] } })
    .mockResolvedValueOnce({ thread: { turns: [] } })
    .mockRejectedValueOnce(new Error('read interrupted'))
  const result = await rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)
  expect(result.fileErrors).toHaveLength(1)
  expect(result.historyError).toContain('read interrupted')
  expect(await readFile(file, 'utf8')).toBe('external edit\n')
})

it('invalidates only the reverted thread caches after native success', async () => {
  const server = new AppServerProcess()
  vi.spyOn(server as any, 'disposeIfConfigChanged').mockImplementation(() => {})
  vi.spyOn(server as any, 'ensureInitialized').mockResolvedValue(undefined)
  const oldHistory = { thread: { id: 'thread', turns: [{ id: 'selected' }] } }
  const call = vi.spyOn(server as any, 'call').mockResolvedValue(oldHistory)
  server.storeThreadReadSnapshot('thread', oldHistory)
  server.storeThreadReadSnapshot('other', oldHistory)
  server.cacheLiveState('thread', oldHistory, 1, 100)
  await server.readThreadForTurnPage('thread')

  call.mockRejectedValueOnce(new Error('revert rejected'))
  await expect(server.rpc('thread/revert', { threadId: 'thread', beforeTurnId: 'selected' })).rejects.toThrow('revert rejected')
  expect(server.getLastThreadReadSnapshot('thread')).toEqual(oldHistory)
  expect(server.getCachedLiveState('thread', 1, 100)).toEqual(oldHistory)
  await server.readThreadForTurnPage('thread')
  expect(call).toHaveBeenCalledTimes(2)

  call.mockResolvedValueOnce({ thread: { id: 'thread', turns: [] } })
  await server.rpc('thread/revert', { threadId: 'thread', beforeTurnId: 'selected' })
  expect(server.getLastThreadReadSnapshot('thread')).toBeNull()
  expect(server.getCachedLiveState('thread', 1, 100)).toBeNull()
  expect(server.getLastThreadReadSnapshot('other')).toEqual(oldHistory)
  call.mockResolvedValueOnce({ thread: { id: 'thread', turns: [] } })
  expect(await server.readThreadForTurnPage('thread')).toEqual({ thread: { id: 'thread', turns: [] } })
  expect(call).toHaveBeenCalledTimes(4)
})

it.each([
  { staleFails: false, currentFails: false },
  { staleFails: true, currentFails: false },
  { staleFails: false, currentFails: true },
  { staleFails: true, currentFails: true },
])('follows the current page read after revert (staleFails=$staleFails, currentFails=$currentFails)', async ({ staleFails, currentFails }) => {
  const server = new AppServerProcess()
  vi.spyOn(server as any, 'disposeIfConfigChanged').mockImplementation(() => {})
  vi.spyOn(server as any, 'ensureInitialized').mockResolvedValue(undefined)
  let resolveOld!: (value: unknown) => void
  let rejectOld!: (error: Error) => void
  let resolveCurrent!: (value: unknown) => void
  let rejectCurrent!: (error: Error) => void
  const oldRequest = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
  const currentRequest = new Promise((resolve, reject) => { resolveCurrent = resolve; rejectCurrent = reject })
  const call = vi.spyOn(server as any, 'call')
    .mockReturnValueOnce(oldRequest)
    .mockResolvedValueOnce({ thread: { turns: [] } })
    .mockReturnValueOnce(currentRequest)

  const oldRead = server.readThreadForTurnPage('thread')
  await server.rpc('thread/revert', { threadId: 'thread', beforeTurnId: 'selected' })
  const currentRead = server.readThreadForTurnPage('thread')
  const results = Promise.allSettled([oldRead, currentRead])
  const pending = (server as any).threadTurnPageReadPromiseByThreadId.get('thread')
  if (staleFails) rejectOld(new Error('stale read failed'))
  else resolveOld({ thread: { turns: [{ id: 'selected' }] } })
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
  expect((server as any).threadTurnPageReadPromiseByThreadId.get('thread')).toBe(pending)
  expect((server as any).threadTurnPageReadCacheByThreadId.has('thread')).toBe(false)
  expect(call).toHaveBeenCalledTimes(3)

  const retained = { thread: { turns: [{ id: 'earlier' }] } }
  const failure = new Error('current read failed')
  if (currentFails) rejectCurrent(failure)
  else resolveCurrent(retained)
  expect(await results).toEqual(currentFails
    ? [{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]
    : [{ status: 'fulfilled', value: retained }, { status: 'fulfilled', value: retained }])
  if (!currentFails) expect(await server.readThreadForTurnPage('thread')).toEqual(retained)
  expect(call).toHaveBeenCalledTimes(3)
  expect((server as any).threadTurnPageReadPromiseByThreadId.has('thread')).toBe(false)
})

it('keeps a late pre-snapshot read from replacing the new page cache', async () => {
  const server = new AppServerProcess()
  vi.spyOn(server as any, 'disposeIfConfigChanged').mockImplementation(() => {})
  vi.spyOn(server as any, 'ensureInitialized').mockResolvedValue(undefined)
  let resolveOld!: (value: unknown) => void
  const retained = { thread: { turns: [{ id: 'earlier' }] } }
  const call = vi.spyOn(server as any, 'call')
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValueOnce(retained)
  const oldRead = server.readThreadForTurnPage('thread')
  await Promise.resolve()
  server.storeThreadReadSnapshot('thread', retained)
  expect(await server.readThreadForTurnPage('thread')).toEqual(retained)
  resolveOld({ thread: { turns: [{ id: 'selected' }] } })
  expect(await oldRead).toEqual(retained)
  expect(await server.readThreadForTurnPage('thread')).toEqual(retained)
  expect(server.getLastThreadReadSnapshot('thread')).toEqual(retained)
  expect(call).toHaveBeenCalledTimes(2)
})
