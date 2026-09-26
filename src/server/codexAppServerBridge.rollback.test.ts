import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rollbackThreadWithFiles } from './codexAppServerBridge'

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
    throw new Error('thread/rollback unsupported')
  })
  await expect(rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)).rejects.toThrow('unsupported')
  expect(await readFile(file, 'utf8')).toBe('after\n')
})

it('captures patches before rollback removes the selected turns', async () => {
  const { file, log } = await setup()
  const rpc = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'thread/read') return { thread: { path: log, turns: [{ id: 'earlier' }, { id: 'selected' }, { id: 'later' }] } }
    expect(params).toEqual({ threadId: 'thread', numTurns: 2 })
    expect(await readFile(file, 'utf8')).toBe('after\n')
    await writeFile(log, '')
    return { thread: { turns: [{ id: 'earlier' }] } }
  })
  const result = await rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)
  expect(result.fileErrors).toEqual([])
  expect(await readFile(file, 'utf8')).toBe('before\n')
})

it('returns partial file failures along with the completed history result', async () => {
  const { file, log } = await setup('external edit\n')
  const rpc = vi.fn(async (method: string) => method === 'thread/read'
    ? { thread: { path: log, turns: [{ id: 'selected' }] } }
    : { thread: { turns: [] } })
  const result = await rollbackThreadWithFiles({ rpc }, 'thread', 'selected', directory)
  expect(result.fileErrors).toHaveLength(1)
  expect(result.result).toEqual({ thread: { turns: [] } })
  expect(await readFile(file, 'utf8')).toBe('external edit\n')
})
