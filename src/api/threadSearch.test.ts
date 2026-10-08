import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSearchTurnMessages, searchThreadOccurrences, searchThreads } from './codexGateway'
import { CodexApiError } from './codexErrors'
import { isNativeHistoryUnsupported, titleMatchRank } from './threadSearch'

afterEach(() => vi.unstubAllGlobals())

describe('native thread search', () => {
  it('ranks exact titles before ordered-character matches, including Unicode', () => {
    expect(titleMatchRank('Code Review', 'code')).toBe(0)
    expect(titleMatchRank('Code Review', 'cdrvw')).toBe(1)
    expect(titleMatchRank('中文文件整理', '中件理')).toBe(1)
    expect(titleMatchRank('中文文件整理', '理中')).toBe(2)
  })

  it('only downgrades explicit unsupported errors, not authentication, timeout or network failures', () => {
    expect(isNativeHistoryUnsupported(new Error('Method not found: thread/search'))).toBe(true)
    expect(isNativeHistoryUnsupported(new Error('Thread search is not supported by this storage'))).toBe(true)
    expect(isNativeHistoryUnsupported(new Error('Search timed out'))).toBe(false)
    expect(isNativeHistoryUnsupported(new CodexApiError('storage unavailable', { code: 'network_error' }))).toBe(false)
    expect(isNativeHistoryUnsupported(new CodexApiError('method not found', { code: 'http_error', status: 403 }))).toBe(false)
  })

  it('uses native pagination and preserves real turn IDs without assigning local global indices', async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init.body))
      requests.push(request)
      if (request.method === 'thread/search') return Response.json({ result: {
        data: [{ thread: { id: 'outside-sidebar', name: 'Found', preview: 'preview', cwd: '/tmp', createdAt: 1, updatedAt: 2, turns: [] } }], nextCursor: 'next',
      } })
      if (request.method === 'thread/searchOccurrences') return Response.json({ result: { data: [], nextCursor: 'older' } })
      return Response.json({ result: { data: [{ id: 'real-turn', status: 'completed', error: null, items: [{ type: 'agentMessage', id: 'answer', text: 'Found' }] }] } })
    }))
    expect((await searchThreads('Found', 50, 'page', true)).threads[0]?.id).toBe('outside-sidebar')
    expect((await searchThreadOccurrences('thread', '中文', 'occurrence')).nextCursor).toBe('older')
    expect((await getSearchTurnMessages('thread', 'turn-cursor'))[0]).toMatchObject({ id: 'answer', turnId: 'real-turn', turnIndex: undefined })
    expect(requests).toEqual([
      { method: 'thread/search', params: { searchTerm: 'Found', limit: 50, cursor: 'page', archived: true, sortKey: 'updated_at' } },
      { method: 'thread/searchOccurrences', params: { threadId: 'thread', searchTerm: '中文', cursor: 'occurrence', limit: 50 } },
      { method: 'thread/turns/list', params: { threadId: 'thread', cursor: 'turn-cursor', limit: 1, sortDirection: 'asc', itemsView: 'full' } },
    ])
  })
})
