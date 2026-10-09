import { effectScope, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadTurnPage } from '../api/codexGateway'
import { useThreadHistoryWindow } from './useThreadHistoryWindow'
import { ACTIVE_THREAD_TEXT_BUDGET } from './threadMessageRetention'

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

  it.each(['older', 'newer'] as const)('reaches and passes an oversized middle turn when paging %s', async (direction) => {
    const oversizedText = 'x'.repeat(ACTIVE_THREAD_TEXT_BUDGET / 2)
    const oversizedPage = (start: number, count: number) => {
      const result = page(start, count)
      result.messages.find((message) => message.turnId === 'turn-25')!.text = oversizedText
      return result
    }
    api.latest.mockResolvedValue(page(direction === 'older' ? 30 : 0, 20))
    api[direction].mockResolvedValueOnce(oversizedPage(20, 10))
    api[direction].mockResolvedValueOnce(oversizedPage(direction === 'older' ? 16 : 25, 10))
    api[direction].mockResolvedValueOnce(page(direction === 'older' ? 15 : 26, 10))
    const { state } = windowFor()
    const load = direction === 'older' ? state.loadOlder : state.loadNewer
    await state.loadLatest()
    await load()
    expect(state.detail.value?.messages).toHaveLength(20)
    expect(state.detail.value?.messages[0]?.turnId).toBe(direction === 'older' ? 'turn-26' : 'turn-5')
    expect(state.detail.value?.messages.at(-1)?.turnId).toBe(direction === 'older' ? 'turn-45' : 'turn-24')
    expect(state.detail.value).toMatchObject({ hasMoreOlder: true, hasMoreNewer: true })
    await load()
    expect(state.detail.value?.messages).toEqual([expect.objectContaining({ turnId: 'turn-25', text: oversizedText, turnIndex: 25 })])
    expect(state.detail.value?.startTurnIndex).toBe(25)
    expect(state.detail.value).toMatchObject({ hasMoreOlder: true, hasMoreNewer: true })
    await load()
    expect(state.detail.value?.messages).toHaveLength(10)
    expect(state.detail.value?.messages[0]?.turnId).toBe(direction === 'older' ? 'turn-15' : 'turn-26')
    expect(state.detail.value?.messages.at(-1)?.turnId).toBe(direction === 'older' ? 'turn-24' : 'turn-35')
    expect(api[direction].mock.calls).toEqual(direction === 'older'
      ? [['thread', 'turn-30'], ['thread', 'turn-26'], ['thread', 'turn-25']]
      : [['thread', 'turn-19'], ['thread', 'turn-24'], ['thread', 'turn-25']])
    expect(state.detail.value?.nextTurnIndex).toBe(100)
    expect(Object.keys(state.detail.value?.turnIndexByTurnId ?? {})).toHaveLength(10)
  })

  it('keeps newer paging available for unseen turns in an end page', async () => {
    const oversizedText = 'x'.repeat(ACTIVE_THREAD_TEXT_BUDGET / 2)
    const endPage = (start: number) => {
      const result = { ...page(start, 30 - start), hasMoreNewer: false }
      const oversized = result.messages.find((message) => message.turnId === 'turn-25')
      if (oversized) oversized.text = oversizedText
      return result
    }
    api.latest.mockResolvedValue(page(0, 20))
    api.newer.mockResolvedValueOnce(endPage(20))
    api.newer.mockResolvedValueOnce(endPage(25))
    api.newer.mockResolvedValueOnce(endPage(26))
    const { state } = windowFor()
    await state.loadLatest()
    await state.loadNewer()
    expect(state.detail.value?.hasMoreNewer).toBe(true)
    await state.loadNewer()
    expect(state.detail.value?.messages[0]?.turnId).toBe('turn-25')
    expect(state.detail.value?.hasMoreNewer).toBe(true)
    await state.loadNewer()
    expect(state.detail.value?.hasMoreNewer).toBe(false)
    expect(state.detail.value?.messages.map((message) => message.turnId)).toEqual(['turn-26', 'turn-27', 'turn-28', 'turn-29'])
    expect(api.newer.mock.calls).toEqual([['thread', 'turn-19'], ['thread', 'turn-24'], ['thread', 'turn-25']])
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
