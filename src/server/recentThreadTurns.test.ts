import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readRecentThreadTurns } from './recentThreadTurns'

const temporaryRoots: string[] = []
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('reads only the newest ten turns and the real compaction timestamp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-recent-'))
  temporaryRoots.push(root)
  const sessions = join(root, 'sessions')
  const day = join(sessions, '2026', '09', '22')
  await mkdir(day, { recursive: true })
  const threadId = 'test-thread'
  const path = join(day, `rollout-${threadId}.jsonl`)
  const rows = Array.from({ length: 13 }, (_, index) => [
    { timestamp: `2026-09-22T00:00:${String(index).padStart(2, '0')}Z`, type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${index}` } },
    { timestamp: `2026-09-22T00:00:${String(index).padStart(2, '0')}Z`, type: 'response_item', payload: { type: 'message', id: `msg-${index}`, role: 'user', content: [{ type: 'input_text', text: index === 0 ? 'x'.repeat(70_000) : `Question ${index}` }] } },
    ...(index === 12 ? [{ timestamp: '2026-09-22T00:00:14Z', ordinal: 99, type: 'compacted', payload: { message: 'private summary' } }] : []),
  ]).flat()
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')

  const page = await readRecentThreadTurns(path, sessions, threadId)
  expect(page?.turns).toHaveLength(10)
  expect(page?.turns[0]?.id).toBe('turn-3')
  expect(page?.hasMoreOlder).toBe(true)
  expect(page?.turns.at(-1)?.items).toEqual([
    { id: 'msg-12', type: 'userMessage', content: [{ type: 'text', text: 'Question 12' }], createdAtIso: '2026-09-22T00:00:12Z' },
    { id: 'compaction-99', type: 'contextCompaction', createdAtIso: '2026-09-22T00:00:14Z' },
  ])
  expect(JSON.stringify(page)).not.toContain('private summary')
  expect(await readRecentThreadTurns(path, sessions, 'other-thread')).toBeNull()
  const otherRoot = join(root, 'other-sessions')
  await mkdir(otherRoot)
  expect(await readRecentThreadTurns(path, otherRoot, threadId)).toBeNull()
})
