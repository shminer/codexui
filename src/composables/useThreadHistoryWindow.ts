import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { getLatestThreadMessages, getNewerThreadMessages, getOlderThreadMessages, type ThreadTurnPage } from '../api/codexGateway'
import {
  ACTIVE_THREAD_TEXT_BUDGET,
  ACTIVE_THREAD_TURN_LIMIT,
  retainThreadMessageWindow,
} from './threadMessageRetention'

export function useThreadHistoryWindow(threadId: Readonly<Ref<string>>) {
  const detail = ref<ThreadTurnPage | null>(null)
  const loading = ref(false)
  const loadingOlder = ref(false)
  const loadingNewer = ref(false)
  const error = ref('')
  let generation = 0
  let lastDirection: 'latest' | 'older' | 'newer' = 'latest'
  let olderAnchor = ''
  let newerAnchor = ''

  function reset(): void {
    generation += 1
    detail.value = null
    loading.value = loadingOlder.value = loadingNewer.value = false
    error.value = ''
    olderAnchor = newerAnchor = ''
  }

  async function load(direction: 'latest' | 'older' | 'newer'): Promise<void> {
    const id = threadId.value
    const previous = detail.value
    if (!id || (direction !== 'latest' && (!previous || loading.value || loadingOlder.value || loadingNewer.value))) return
    const anchor = direction === 'older' ? olderAnchor : newerAnchor
    if (direction !== 'latest' && !anchor) return
    const request = ++generation
    lastDirection = direction
    loading.value = direction === 'latest'
    loadingOlder.value = direction === 'older'
    loadingNewer.value = direction === 'newer'
    error.value = ''
    try {
      const page = direction === 'latest'
        ? await getLatestThreadMessages(id)
        : direction === 'older'
          ? await getOlderThreadMessages(id, anchor)
          : await getNewerThreadMessages(id, anchor)
      if (request !== generation || id !== threadId.value) return
      const merged = direction === 'latest' ? page.messages : direction === 'older'
        ? [...page.messages, ...previous!.messages] : [...previous!.messages, ...page.messages]
      const window = retainThreadMessageWindow([...new Map(merged.map((message) => [message.id, message])).values()], {
        maxTurns: ACTIVE_THREAD_TURN_LIMIT,
        maxBytes: ACTIVE_THREAD_TEXT_BUDGET,
        direction: direction === 'older' ? 'earliest' : 'latest',
      })
      const indices = { ...(direction === 'latest' ? {} : previous?.turnIndexByTurnId), ...page.turnIndexByTurnId }
      const retainedIds = new Set(window.messages.flatMap((message) => message.turnId ? [message.turnId] : []))
      const pageTurns = Object.entries(page.turnIndexByTurnId).sort((first, second) => first[1] - second[1])
      if (direction !== 'newer' && pageTurns.length) olderAnchor = pageTurns[0][0]
      if (direction !== 'older' && pageTurns.length) newerAnchor = pageTurns[pageTurns.length - 1][0]
      if (direction === 'latest' && !pageTurns.length) olderAnchor = newerAnchor = ''
      if (window.removedOlder) olderAnchor = window.messages.find((message) => message.turnId)?.turnId ?? olderAnchor
      if (window.removedNewer) newerAnchor = [...window.messages].reverse().find((message) => message.turnId)?.turnId ?? newerAnchor
      detail.value = {
        ...page,
        messages: window.messages,
        hasMoreOlder: (direction === 'newer' ? previous!.hasMoreOlder : page.hasMoreOlder) || window.removedOlder,
        hasMoreNewer: (direction === 'older' ? previous!.hasMoreNewer === true : page.hasMoreNewer === true) || window.removedNewer,
        turnIndexByTurnId: Object.fromEntries(Object.entries(indices).filter(([turnId]) => retainedIds.has(turnId))),
        startTurnIndex: indices[olderAnchor] ?? page.startTurnIndex,
        nextTurnIndex: direction === 'latest' ? page.nextTurnIndex : Math.max(previous?.nextTurnIndex ?? 0, page.nextTurnIndex ?? 0),
      }
    } catch (failure) {
      if (request !== generation || id !== threadId.value) return
      error.value = failure instanceof Error ? failure.message : 'Failed to load conversation history'
      throw failure
    } finally {
      if (request === generation) loading.value = loadingOlder.value = loadingNewer.value = false
    }
  }

  watch(threadId, reset, { flush: 'sync' })
  onScopeDispose(reset)
  return {
    detail, loading, loadingOlder, loadingNewer, error, reset,
    loadLatest: () => load('latest'),
    loadOlder: () => load('older'),
    loadNewer: () => load('newer'),
    retry: () => load(lastDirection),
  }
}
