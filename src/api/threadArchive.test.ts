import { afterEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { getThreadGroupsPage, unarchiveThread } from './codexGateway'

afterEach(() => vi.unstubAllGlobals())

it('opens archived rows in a read-only preview without resuming or restoring', async () => {
  const library = await readFile(new URL('../components/sidebar/ThreadLibrary.vue', import.meta.url), 'utf8')
  const preview = await readFile(new URL('../components/sidebar/ThreadArchivePreview.vue', import.meta.url), 'utf8')
  expect(library).toContain('archived ? previewThread = thread')
  expect(preview).toContain('useThreadHistoryWindow(computed(() => props.thread.id))')
  expect(preview).toContain(':load-later-messages="loadNewer"')
  expect(preview).toContain(':load-latest-messages="loadLatest"')
  expect(preview).toContain(':readonly="true"')
  expect(preview).not.toMatch(/resumeThread|unarchiveThread|turn\/start/u)
})

it('lists archived threads by cursor and restores through the native RPC', async () => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    requests.push(JSON.parse(String(init.body)))
    return Response.json({ result: { data: [], nextCursor: null } })
  }))
  await getThreadGroupsPage('older', 50, true)
  await unarchiveThread('archived')
  expect(requests).toEqual([
    { method: 'thread/list', params: { archived: true, limit: 50, sortKey: 'updated_at', modelProviders: [], cursor: 'older' } },
    { method: 'thread/unarchive', params: { threadId: 'archived' } },
  ])
})
