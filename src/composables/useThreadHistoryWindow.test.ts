import { effectScope, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadTurnPage } from '../api/codexGateway'
import { useThreadHistoryWindow } from './useThreadHistoryWindow'

const api = vi.hoisted(() => ({ latest: vi.fn(), older: vi.fn(), newer: vi.fn() }))
vi.mock('../api/codexGateway', () => ({
  getLatestThreadMessages: api.latest,
  getOlderThreadMessages: api.older,
  getNewerThreadMessages: api.newer,
}))
const scopes: EffectScope[] = []

function page(start: number, count: number): ThreadTurnPage {
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `message-${start + index}`, turnId: `turn-${start + index}`, turnIndex: start + index,
    role: 'assistant' as const, text: `answer ${start + index}`,
  }))
  return {
    messages, inProgress: false, activeTurnId: '', startTurnIndex: start,
    hasMoreOlder: start > 0, hasMoreNewer: start + count < 100, nextTurnIndex: 100,
    turnIndexByTurnId: Object.fromEntries(messages.map((message) => [message.turnId, message.turnIndex])),
  }
}

function windowFor(id = ref('thread')) {
  const scope = effectScope()
  scopes.push(scope)
  return { id, state: scope.run(() => useThreadHistoryWindow(id))! }
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })

describe('read-only thread history windows', () => {
  it('replaces the opposite end when paging in either direction', async () => {
    api.latest.mockResolvedValue(page(80, 20))
    api.older.mockResolvedValue(page(70, 10))
    api.newer.mockResolvedValue(page(90, 10))
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadOlder()
    expect(state.detail.value?.messages).toHaveLength(20)
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-70')
    expect(state.detail.value?.hasMoreNewer).toBe(true)
    expect(api.older).toHaveBeenCalledWith('thread', 'turn-80')
    await state.loadNewer()
    expect(api.newer).toHaveBeenCalledWith('thread', 'turn-89')
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-80')
    expect(state.detail.value?.hasMoreNewer).toBe(false)
    expect(Object.keys(state.detail.value?.turnIndexByTurnId ?? {})).toHaveLength(20)
  })

  it('rejects a late response after a thread switch', async () => {
    let finish!: (value: ThreadTurnPage) => void
    api.latest.mockReturnValueOnce(new Promise<ThreadTurnPage>((resolve) => { finish = resolve }))
    api.latest.mockResolvedValueOnce(page(0, 1))
    const { id, state } = windowFor()
    const oldRequest = state.loadLatest()
    id.value = 'other-thread'
    await state.loadLatest()
    finish(page(80, 20))
    await oldRequest
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-0')
  })

  it('advances raw turn boundaries even when a page has no displayable messages', async () => {
    api.latest.mockResolvedValue({ ...page(80, 20), messages: [] })
    api.older.mockResolvedValueOnce({ ...page(70, 10), messages: [] })
    api.older.mockResolvedValueOnce(page(60, 10))
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadOlder()
    await state.loadOlder()
    expect(api.older.mock.calls).toEqual([['thread', 'turn-80'], ['thread', 'turn-70']])
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-60')
    expect(state.detail.value?.hasMoreOlder).toBe(true)
  })

  it('preserves the current window on failure and retries the failed direction', async () => {
    api.latest.mockResolvedValue(page(80, 20))
    const { state } = windowFor()
    await state.loadLatest()
    const previous = state.detail.value
    api.older.mockRejectedValueOnce(new Error('stale_window'))
    await expect(state.loadOlder()).rejects.toThrow('stale_window')
    expect(state.detail.value).toBe(previous)
    api.older.mockResolvedValueOnce(page(70, 10))
    await state.retry()
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-70')
  })
})
