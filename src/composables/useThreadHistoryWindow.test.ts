import { effectScope, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadTurnPage } from '../api/codexGateway'
import { useThreadHistoryWindow } from './useThreadHistoryWindow'
import { ACTIVE_THREAD_TEXT_BUDGET, THREAD_HISTORY_TEXT_BUDGET } from './threadMessageRetention'

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

function windowFor(id = ref('thread'), prepareSnapshot?: Parameters<typeof useThreadHistoryWindow>[1]) {
  const scope = effectScope()
  scopes.push(scope)
  return { id, state: scope.run(() => useThreadHistoryWindow(id, prepareSnapshot))! }
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })

describe('read-only thread history windows', () => {
  it('rebases only an accepted latest window, not older or partially retained pages', async () => {
    const accept = vi.fn()
    const prepare = vi.fn(() => accept)
    api.latest.mockResolvedValue(page(80, 20))
    api.older.mockResolvedValue(page(70, 10))
    api.newer.mockResolvedValue({ ...page(100, 10), hasMoreNewer: false })
    const { state } = windowFor(ref('thread'), prepare)
    await state.loadLatest()
    expect(prepare).toHaveBeenCalledWith('thread')
    expect(accept).toHaveBeenCalledWith(state.detail.value?.messages)
    await state.loadOlder()
    expect(accept).toHaveBeenCalledTimes(1)
    await state.loadNewer()
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenLastCalledWith(page(100, 10).messages)
    expect(api.newer).toHaveBeenCalledWith('thread', 'turn-99')
  })

  it('does not apply an obsolete snapshot callback after changing the selected thread', async () => {
    const accepts = new Map([['thread', vi.fn()], ['other-thread', vi.fn()]])
    let finish!: (value: ThreadTurnPage) => void
    api.latest.mockReturnValueOnce(new Promise<ThreadTurnPage>((resolve) => { finish = resolve }))
    api.latest.mockResolvedValueOnce({ ...page(0, 1), hasMoreNewer: false })
    const { id, state } = windowFor(ref('thread'), threadId => accepts.get(threadId)!)
    const old = state.loadLatest()
    id.value = 'other-thread'
    await state.loadLatest()
    finish(page(80, 20))
    await old
    expect(accepts.get('thread')).not.toHaveBeenCalled()
    expect(accepts.get('other-thread')).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest empty running turn cursor while prepending history', async () => {
    api.latest.mockResolvedValue({ ...page(100, 0), inProgress: true, activeTurnId: 'turn-100', hasMoreOlder: true, hasMoreNewer: false, turnIndexByTurnId: { 'turn-100': 100 } })
    api.older.mockResolvedValue(page(90, 10))
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadOlder()
    expect(state.detail.value?.hasMoreNewer).toBe(false)
    expect(state.detail.value?.messages.at(-1)?.turnId).toBe('turn-99')
    expect(state.detail.value?.inProgress).toBe(true)
  })

  it('keeps both ends when paging and preserves expanded history on ordinary return to latest', async () => {
    api.latest.mockResolvedValue(page(80, 20))
    api.older.mockResolvedValue(page(70, 10))
    api.newer.mockResolvedValue(page(90, 10))
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadOlder()
    expect(state.detail.value?.messages).toHaveLength(30)
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-70')
    expect(state.detail.value?.hasMoreNewer).toBe(false)
    expect(api.older).toHaveBeenCalledWith('thread', 'turn-80')
    await state.loadLatest()
    expect(state.detail.value?.messages).toHaveLength(30)
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-70')
    await state.releaseHistory()
    expect(state.detail.value?.messages).toHaveLength(20)
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-80')
  })

  it('compacts new pages only after the reader follows their latest boundary', async () => {
    api.latest.mockResolvedValue(page(80, 20))
    api.older.mockResolvedValue(page(70, 10))
    api.newer.mockResolvedValue({ ...page(100, 10), hasMoreNewer: false })
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadOlder()
    state.setReadingHistory(false)
    expect(state.detail.value?.messages).toHaveLength(30)
    await state.loadNewer()
    expect(state.detail.value?.messages).toHaveLength(40)
    state.setReadingHistory(true)
    expect(state.detail.value?.messages).toHaveLength(40)
    state.setReadingHistory(false)
    expect(state.detail.value?.messages).toHaveLength(20)
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-90')
  })

  it('keeps fuller duplicate content and expanded history when a stale latest snapshot repeats', async () => {
    const latest = page(80, 20)
    latest.messages[19].text = 'complete answer'
    api.latest.mockResolvedValueOnce(latest)
    api.older.mockResolvedValue(page(70, 10))
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadOlder()
    const stale = page(80, 20)
    stale.messages[19].text = 'complete'
    api.latest.mockResolvedValueOnce(stale)
    await state.loadLatest()
    expect(state.detail.value?.messages).toHaveLength(30)
    expect(state.detail.value?.messages.at(-1)?.text).toBe('complete answer')
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

  it.each(['older', 'newer'] as const)('retains adjacent turns beyond the normal budget when paging %s', async (direction) => {
    const incoming = page(20, 10)
    incoming.messages[5].text = 'x'.repeat(ACTIVE_THREAD_TEXT_BUDGET / 2)
    api.latest.mockResolvedValue(page(direction === 'older' ? 30 : 0, 20))
    api[direction].mockResolvedValue(incoming)
    const { state } = windowFor()
    await state.loadLatest()
    await (direction === 'older' ? state.loadOlder() : state.loadNewer())
    expect(state.detail.value?.messages).toHaveLength(30)
    expect(state.detail.value?.messages.find(message => message.turnId === 'turn-25')?.text).toHaveLength(ACTIVE_THREAD_TEXT_BUDGET / 2)
    expect(state.capacityReached.value).toBe(false)
  })

  it.each(['older', 'newer'] as const)('pauses at the hard byte limit and leaves the loaded window intact when paging %s', async (direction) => {
    const incoming = page(20, 10)
    incoming.messages[direction === 'older' ? 9 : 0].text = 'x'.repeat(THREAD_HISTORY_TEXT_BUDGET / 2)
    api.latest.mockResolvedValue(page(direction === 'older' ? 30 : 0, 20))
    api[direction].mockResolvedValue(incoming)
    const { state } = windowFor()
    await state.loadLatest()
    const original = state.detail.value?.messages
    const load = direction === 'older' ? state.loadOlder : state.loadNewer
    await load()
    expect(state.detail.value?.messages).toEqual(original)
    expect(state.capacityReached.value).toBe(true)
    await load()
    expect(api[direction]).toHaveBeenCalledTimes(1)
    api.latest.mockRejectedValueOnce(new Error('offline'))
    await expect(state.releaseHistory()).rejects.toThrow('offline')
    expect(state.detail.value?.messages).toEqual(original)
    expect(state.capacityReached.value).toBe(true)
    await state.releaseHistory()
    expect(state.capacityReached.value).toBe(false)
  })

  it.each(['older', 'newer'] as const)('advances consecutive empty raw pages and preserves the start watermark when paging %s', async (direction) => {
    api.latest.mockResolvedValue({ ...page(40, 10), messages: [] })
    const step = direction === 'older' ? -10 : 10
    api[direction].mockResolvedValueOnce({ ...page(40 + step, 10), messages: [] })
    api[direction].mockResolvedValueOnce({ ...page(40 + 2 * step, 10), messages: [] })
    api[direction].mockResolvedValueOnce(page(40 + 3 * step, 10))
    const { state } = windowFor()
    const load = direction === 'older' ? state.loadOlder : state.loadNewer
    await state.loadLatest()
    await load()
    expect(state.detail.value?.messages).toEqual([])
    expect(state.detail.value?.startTurnIndex).toBe(direction === 'older' ? 30 : 40)
    await load()
    expect(state.detail.value?.messages).toEqual([])
    expect(state.detail.value?.startTurnIndex).toBe(direction === 'older' ? 20 : 40)
    await load()
    expect(api[direction].mock.calls).toEqual(direction === 'older'
      ? [['thread', 'turn-40'], ['thread', 'turn-30'], ['thread', 'turn-20']]
      : [['thread', 'turn-49'], ['thread', 'turn-59'], ['thread', 'turn-69']])
    expect(state.detail.value?.messages[0]?.turnId).toBe(direction === 'older' ? 'turn-10' : 'turn-70')
    expect(state.detail.value?.startTurnIndex).toBe(direction === 'older' ? 10 : 40)
    expect(state.detail.value?.nextTurnIndex).toBe(100)
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
