import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readPersistedCommandOutputs } from './persistedCommandOutput'

let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

async function setup(threadId = 'thread') {
  directory = await mkdtemp(join(tmpdir(), 'codexui-output-'))
  const sessions = join(directory, 'sessions')
  await mkdir(sessions)
  const path = join(sessions, 'session.jsonl')
  const rows = [
    { type: 'session_meta', payload: { id: threadId } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'other-turn' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'other', arguments: '{"cmd":"echo other"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'other', output: 'other' } },
    { type: 'turn_context', payload: { turn_id: 'turn' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call-with-dashes', arguments: '{"cmd":"echo ok"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-with-dashes', output: 'Output:\nok' } },
  ]
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n'))
  return { path, sessions }
}

it('recovers a synthetic command by its exact turn and call id', async () => {
  const { path, sessions } = await setup()
  const output = await readPersistedCommandOutputs(path, [sessions], 'thread',
    [{ itemId: 'session-cmd-call-with-dashes', turnId: 'turn', command: 'echo ok' }], (raw) => raw.replace(/^Output:\n/u, ''))
  expect(output.get('session-cmd-call-with-dashes')).toEqual({ text: 'ok', command: 'echo ok' })
  expect(await readPersistedCommandOutputs(path, [sessions], 'thread',
    [{ itemId: 'session-cmd-call-with-dashes', turnId: 'other-turn' }], (raw) => raw)).toEqual(new Map())
})

it('rejects mismatched session identities, roots and symlink escapes', async () => {
  const { path, sessions } = await setup('different-thread')
  const target = [{ itemId: 'session-cmd-call-with-dashes', turnId: 'turn' }]
  expect(await readPersistedCommandOutputs(path, [sessions], 'thread', target, (raw) => raw)).toEqual(new Map())
  const otherRoot = join(directory, 'other')
  await mkdir(otherRoot)
  const link = join(otherRoot, 'escaped.jsonl')
  await symlink(path, link)
  expect(await readPersistedCommandOutputs(link, [otherRoot], 'different-thread', target, (raw) => raw)).toEqual(new Map())
})
