import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { getLatestThreadMessages, getNewerThreadMessages, getOlderThreadMessages, type ThreadTurnPage } from '../api/codexGateway'
import {
  ACTIVE_THREAD_TEXT_BUDGET,
  ACTIVE_THREAD_TURN_LIMIT,
  admitThreadHistoryPage,
  retainThreadMessageWindow,
} from './threadMessageRetention'

export function useThreadHistoryWindow(
  threadId: Readonly<Ref<string>>,
  prepareLatestSnapshot?: (threadId: string) => (messages: ThreadTurnPage['messages']) => void,
) {
  const detail = ref<ThreadTurnPage | null>(null)
  const loading = ref(false)
  const loadingOlder = ref(false)
  const loadingNewer = ref(false)
  const error = ref('')
  const capacityReached = ref(false)
  let generation = 0
  let lastDirection: 'latest' | 'older' | 'newer' = 'latest'
  let historyChanged = false
  let olderAnchor = ''
  let newerAnchor = ''

  function reset(): void {
    generation += 1
    detail.value = null
    loading.value = loadingOlder.value = loadingNewer.value = false
    error.value = ''
    capacityReached.value = false
    historyChanged = false
    olderAnchor = newerAnchor = ''
  }

  function setReadingHistory(reading: boolean): void {
    const current = detail.value
    if (reading || !historyChanged || !current || current.hasMoreNewer) return
    const retained = retainThreadMessageWindow(current.messages, {
      maxTurns: ACTIVE_THREAD_TURN_LIMIT, maxBytes: ACTIVE_THREAD_TEXT_BUDGET, direction: 'latest',
    })
    if (retained.removedOlder) olderAnchor = retained.messages.find(message => message.turnId)?.turnId ?? olderAnchor
    const ids = new Set(retained.messages.map(message => message.turnId))
    detail.value = { ...current, messages: retained.messages,
      hasMoreOlder: current.hasMoreOlder || retained.removedOlder,
      startTurnIndex: current.turnIndexByTurnId[olderAnchor] ?? current.startTurnIndex,
      turnIndexByTurnId: Object.fromEntries(Object.entries(current.turnIndexByTurnId).filter(([id]) => ids.has(id) || id === olderAnchor || id === newerAnchor)) }
    capacityReached.value = false
    historyChanged = false
  }

  async function load(direction: 'latest' | 'older' | 'newer'): Promise<void> {
    const id = threadId.value
    const previous = detail.value
    if (!id || (direction !== 'latest' && (!previous || loading.value || loadingOlder.value || loadingNewer.value))) return
    if (direction !== 'latest' && capacityReached.value) return
    const anchor = direction === 'older' ? olderAnchor : newerAnchor
    if (direction !== 'latest' && !anchor) return
    const request = ++generation
    const acceptSnapshot = prepareLatestSnapshot?.(id)
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
      const previousById = new Map(previous?.messages.map(message => [message.id, message]))
      const lastIndex = previous?.turnIndexByTurnId[newerAnchor] ?? -1
      const hasNewContent = direction === 'latest' && page.messages.some(message => {
        const old = previousById.get(message.id)
        return old ? !old.text.startsWith(message.text)
          || (message.commandExecution?.outputTotalLength ?? message.commandExecution?.aggregatedOutput.length ?? 0) > (old.commandExecution?.outputTotalLength ?? old.commandExecution?.aggregatedOutput.length ?? 0)
          : (message.turnIndex ?? page.turnIndexByTurnId[message.turnId ?? ''] ?? -1) >= lastIndex
      })
      const replace = !previous || hasNewContent
      const pageTurns = Object.entries(page.turnIndexByTurnId).sort((first, second) => first[1] - second[1])
      const admitted = replace ? null : admitThreadHistoryPage(previous.messages, page.messages,
        direction === 'latest' ? 'older' : direction, pageTurns.map(([turnId]) => turnId))
      const acceptedMessages = (admitted?.messages ?? page.messages).map(message => {
        const old = previousById.get(message.id)
        if (!old) return message
        const text = old.text.length > message.text.length && old.text.startsWith(message.text) ? old.text : message.text
        const before = old.commandExecution
        const incoming = message.commandExecution
        const commandExecution = before && incoming && (
          (before.outputTotalLength ?? before.aggregatedOutput.length) > (incoming.outputTotalLength ?? incoming.aggregatedOutput.length)
          || (before.status !== 'inProgress' && incoming.status === 'inProgress')
        ) ? before : incoming
        return { ...message, text, commandExecution }
      })
      if (replace) historyChanged = false
      else if (direction === 'newer' && acceptedMessages.some(message => {
        const old = previousById.get(message.id)
        return !old || old.text !== message.text || old.commandExecution?.aggregatedOutput !== message.commandExecution?.aggregatedOutput
      })) historyChanged = true
      const acceptedTurns = pageTurns.filter(([turnId]) => !admitted || admitted.turnIds.has(turnId))
      const coveredTurns = new Set(acceptedTurns.map(([id]) => id))
      const outside = replace ? [] : previous.messages.filter(message => !message.turnId || !coveredTurns.has(message.turnId))
      const merged = replace ? acceptedMessages : direction === 'older'
        ? [...acceptedMessages, ...outside] : [...outside, ...acceptedMessages]
      const unique = [...new Map(merged.map((message) => [message.id, message])).values()]
      const window = replace ? retainThreadMessageWindow(unique, {
        maxTurns: ACTIVE_THREAD_TURN_LIMIT, maxBytes: ACTIVE_THREAD_TEXT_BUDGET, direction: 'latest',
      }) : { messages: unique, removedOlder: false, removedNewer: false }
      const indices = { ...(replace ? {} : previous?.turnIndexByTurnId),
        ...Object.fromEntries(acceptedTurns) }
      const retainedIds = new Set(window.messages.flatMap((message) => message.turnId ? [message.turnId] : []))
      capacityReached.value = !replace && (capacityReached.value || admitted?.capacityReached === true)
      if ((replace || direction === 'older') && acceptedTurns.length) olderAnchor = acceptedTurns[0][0]
      if (direction !== 'older' && acceptedTurns.length) newerAnchor = acceptedTurns[acceptedTurns.length - 1][0]
      if (replace && !acceptedTurns.length) olderAnchor = newerAnchor = ''
      if (window.removedOlder) olderAnchor = window.messages.find((message) => message.turnId)?.turnId ?? olderAnchor
      if (window.removedNewer) newerAnchor = [...window.messages].reverse().find((message) => message.turnId)?.turnId ?? newerAnchor
      detail.value = {
        ...page,
        inProgress: direction === 'older' ? previous!.inProgress : page.inProgress,
        activeTurnId: direction === 'older' ? previous!.activeTurnId : page.activeTurnId,
        messages: window.messages,
        hasMoreOlder: (!replace && direction !== 'older' ? previous.hasMoreOlder : page.hasMoreOlder) || window.removedOlder || (direction === 'older' && admitted?.blocked === true),
        hasMoreNewer: (direction === 'older' ? previous!.hasMoreNewer === true : page.hasMoreNewer === true) || window.removedNewer || (direction === 'newer' && admitted?.blocked === true),
        turnIndexByTurnId: Object.fromEntries(Object.entries(indices).filter(([turnId]) => retainedIds.has(turnId) || turnId === olderAnchor || turnId === newerAnchor)),
        startTurnIndex: indices[olderAnchor] ?? (direction === 'newer' ? previous!.startTurnIndex : page.startTurnIndex),
        nextTurnIndex: direction === 'latest' ? page.nextTurnIndex : Math.max(previous?.nextTurnIndex ?? 0, page.nextTurnIndex ?? 0),
      }
      if (direction !== 'older' && !detail.value.hasMoreNewer) acceptSnapshot?.(direction === 'latest' ? window.messages : acceptedMessages)
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
    detail, loading, loadingOlder, loadingNewer, error, reset, capacityReached, setReadingHistory,
    loadLatest: () => load('latest'),
    loadOlder: () => load('older'),
    loadNewer: () => load('newer'),
    retry: () => load(lastDirection),
  }
}
