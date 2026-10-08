import { afterEach, expect, it, vi } from 'vitest'
import { getThreadGroupsPage, unarchiveThread } from './codexGateway'

afterEach(() => vi.unstubAllGlobals())

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
