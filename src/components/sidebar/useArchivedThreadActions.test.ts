import { effectScope, onScopeDispose, type EffectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteThread, unarchiveThread } from '../../api/codexGateway'
import { setUiLanguage, t } from '../../composables/useUiLanguage'
import type { UiThread } from '../../types/codex'
import { useArchivedThreadActions } from './useArchivedThreadActions'

vi.mock('../../api/codexGateway', () => ({ deleteThread: vi.fn(), unarchiveThread: vi.fn() }))

const scopes: EffectScope[] = []
const thread: UiThread = {
  id: 'archived', title: 'Example', cwd: '/project', projectName: 'project', hasWorktree: false,
  createdAtIso: '2026-10-09T00:00:00Z', updatedAtIso: '2026-10-09T00:00:00Z',
  preview: '', unread: false, inProgress: false,
}

function setup() {
  const scope = effectScope()
  scopes.push(scope)
  const removed = vi.fn()
  const actions = scope.run(() => useArchivedThreadActions(removed))!
  return { scope, removed, actions }
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.resetAllMocks()
  setUiLanguage('en')
})

describe('archived conversation actions', () => {
  it('requires confirmation and cancellation sends no request', async () => {
    const { actions } = setup()
    await actions.confirmDelete()
    actions.requestDelete(thread)
    expect(actions.confirmation.value?.id).toBe(thread.id)
    expect(deleteThread).not.toHaveBeenCalled()
    actions.cancelDelete()
    await actions.confirmDelete()
    expect(deleteThread).not.toHaveBeenCalled()
  })

  it('sends one deletion and blocks duplicate deletion and restore', async () => {
    let finish!: () => void
    vi.mocked(deleteThread).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const { actions, removed } = setup()
    actions.requestDelete(thread)
    const request = actions.confirmDelete()
    await actions.confirmDelete()
    await actions.restore(thread.id)
    expect(actions.pending.value.get(thread.id)).toBe('delete')
    expect(deleteThread).toHaveBeenCalledExactlyOnceWith(thread.id)
    expect(unarchiveThread).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
    finish()
    await request
    expect(removed).toHaveBeenCalledExactlyOnceWith(thread.id, 'delete')
    expect(actions.pending.value.size).toBe(0)
    expect(actions.confirmation.value).toBeNull()
  })

  it('blocks deletion while restoring', async () => {
    let finish!: () => void
    vi.mocked(unarchiveThread).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const { actions, removed } = setup()
    actions.requestDelete(thread)
    const request = actions.restore(thread.id)
    await actions.confirmDelete()
    expect(deleteThread).not.toHaveBeenCalled()
    finish()
    await request
    expect(removed).toHaveBeenCalledExactlyOnceWith(thread.id, 'restore')
  })

  it('retains confirmation on failure and allows retry', async () => {
    vi.mocked(deleteThread).mockRejectedValueOnce(new Error('Delete failed')).mockResolvedValueOnce(undefined)
    const { actions, removed } = setup()
    actions.requestDelete(thread)
    await actions.confirmDelete()
    expect(actions.error.value).toBe('Delete failed')
    expect(actions.confirmation.value?.id).toBe(thread.id)
    expect(actions.pending.value.size).toBe(0)
    expect(removed).not.toHaveBeenCalled()
    await actions.confirmDelete()
    expect(actions.error.value).toBe('')
    expect(removed).toHaveBeenCalledExactlyOnceWith(thread.id, 'delete')
  })

  it('does not update a disposed application after deletion completes', async () => {
    let finish!: () => void
    vi.mocked(deleteThread).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const { scope, actions, removed } = setup()
    actions.requestDelete(thread)
    const request = actions.confirmDelete()
    scope.stop()
    finish()
    await request
    expect(removed).not.toHaveBeenCalled()
    expect(actions.pending.value.size).toBe(0)
    expect(actions.confirmation.value).toBeNull()
  })

  it.each(['delete', 'restore'] as const)('keeps %s pending across list remounts and notifies only the new list', async (action) => {
    let finish!: () => void
    vi.mocked(action === 'delete' ? deleteThread : unarchiveThread).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const { actions, removed } = setup()
    const oldList = effectScope()
    const oldRemoved = vi.fn()
    oldList.run(() => { onScopeDispose(actions.subscribeRemoved(oldRemoved)) })
    actions.requestDelete(thread)
    const request = action === 'delete' ? actions.confirmDelete() : actions.restore(thread.id)
    oldList.stop()
    actions.cancelDelete()

    const newList = effectScope()
    scopes.push(newList)
    const newRemoved = vi.fn()
    newList.run(() => { onScopeDispose(actions.subscribeRemoved(newRemoved)) })
    expect(actions.pending.value.get(thread.id)).toBe(action)
    actions.requestDelete(thread)
    await actions.confirmDelete()
    await actions.restore(thread.id)
    expect(deleteThread).toHaveBeenCalledTimes(action === 'delete' ? 1 : 0)
    expect(unarchiveThread).toHaveBeenCalledTimes(action === 'restore' ? 1 : 0)

    finish()
    await request
    expect(removed).toHaveBeenCalledExactlyOnceWith(thread.id, action)
    expect(oldRemoved).not.toHaveBeenCalled()
    expect(newRemoved).toHaveBeenCalledExactlyOnceWith(thread.id, action)
    expect(actions.pending.value.size).toBe(0)
  })

  it('translates labels independently of account status and localizes fallback errors', async () => {
    setUiLanguage('zh-CN')
    expect(t('Current Conversations')).toBe('当前会话')
    expect(t('Archived Conversations')).toBe('归档对话')
    expect(t('Active')).toBe('启用')
    vi.mocked(deleteThread).mockRejectedValueOnce(null)
    const { actions } = setup()
    actions.requestDelete(thread)
    await actions.confirmDelete()
    expect(actions.error.value).toBe('删除对话失败')
    setUiLanguage('en')
    expect(t('Current Conversations')).toBe('Current Conversations')
    expect(t('Archived Conversations')).toBe('Archived Conversations')
  })
})
