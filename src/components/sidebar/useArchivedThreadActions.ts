import { onScopeDispose, ref } from 'vue'
import { deleteThread, unarchiveThread } from '../../api/codexGateway'
import { t } from '../../composables/useUiLanguage'
import type { UiThread } from '../../types/codex'

type ArchiveAction = 'restore' | 'delete'

export function useArchivedThreadActions(onRemoved: (threadId: string, action: ArchiveAction) => void) {
  const pending = ref(new Map<string, ArchiveAction>())
  const confirmation = ref<UiThread | null>(null)
  const error = ref('')
  let disposed = false

  function requestDelete(thread: UiThread): void {
    if (disposed || pending.value.has(thread.id)) return
    error.value = ''
    confirmation.value = thread
  }

  function cancelDelete(): void {
    confirmation.value = null
  }

  async function run(threadId: string, action: ArchiveAction): Promise<void> {
    if (disposed || pending.value.has(threadId)) return
    pending.value.set(threadId, action)
    error.value = ''
    try {
      await (action === 'restore' ? unarchiveThread(threadId) : deleteThread(threadId))
      if (disposed) return
      if (confirmation.value?.id === threadId) confirmation.value = null
      onRemoved(threadId, action)
    } catch (failure) {
      if (!disposed) error.value = failure instanceof Error ? failure.message : t(action === 'restore' ? 'Failed to restore conversation' : 'Failed to delete conversation')
    } finally {
      pending.value.delete(threadId)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (confirmation.value) await run(confirmation.value.id, 'delete')
  }

  onScopeDispose(() => { disposed = true; confirmation.value = null })
  return { pending, confirmation, error, requestDelete, cancelDelete, confirmDelete, restore: (threadId: string) => run(threadId, 'restore') }
}
