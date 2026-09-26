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

it('reports a retained-history read failure after history and files were reverted', async () => {
  const { file, log } = await setup()
  const rpc = vi.fn()
    .mockResolvedValueOnce({ thread: { path: log, turns: [{ id: 'selected' }] } })
    .mockResolvedValueOnce({ thread: { turns: [] } })
    .mockRejectedValueOnce(new Error('read interrupted'))
  await expect(rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)).rejects.toThrow('Conversation history was reverted, but retained history could not be reloaded: read interrupted')
  expect(await readFile(file, 'utf8')).toBe('before\n')
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
