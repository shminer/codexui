import { estimateRetainedBytes } from './threadMemoryPolicy.js'

export const EPHEMERAL_HISTORY_MAX_THREADS = 8
export const EPHEMERAL_HISTORY_MAX_TURNS = 100
export const EPHEMERAL_HISTORY_THREAD_BYTES = 8 * 1024 * 1024
export const EPHEMERAL_HISTORY_TOTAL_BYTES = 32 * 1024 * 1024
export const EPHEMERAL_HISTORY_TTL_MS = 30 * 60_000

type Item = { value: Record<string, unknown>; bytes: number }
type Turn = { index: number; status: string; error: unknown; metadataBytes: number; items: Map<string, Item>; truncated: boolean }
type History = { turns: Map<string, Turn>; seenTurns: Set<string>; bytes: number; nextIndex: number; updatedAt: number; truncated: boolean }

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): string => typeof value === 'string' ? value : ''

export class EphemeralHistoryError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message) }
}

// This is the only retained copy of completed ephemeral items; nothing is written to disk.
export class EphemeralHistoryStore {
  private readonly histories = new Map<string, History>()
  private bytes = 0

  constructor(private readonly limits = {
    threads: EPHEMERAL_HISTORY_MAX_THREADS,
    turns: EPHEMERAL_HISTORY_MAX_TURNS,
    threadBytes: EPHEMERAL_HISTORY_THREAD_BYTES,
    totalBytes: EPHEMERAL_HISTORY_TOTAL_BYTES,
    ttlMs: EPHEMERAL_HISTORY_TTL_MS,
  }, private readonly now = Date.now) {}

  register(threadId: string, truncated = false): void {
    this.remove(threadId)
    this.histories.set(threadId, { turns: new Map(), seenTurns: new Set(), bytes: 0, nextIndex: 0, updatedAt: this.now(), truncated })
    this.prune()
  }

  remove(threadId: string): void {
    const history = this.histories.get(threadId)
    if (history) this.bytes -= history.bytes
    this.histories.delete(threadId)
  }

  clear(): void { this.histories.clear(); this.bytes = 0 }

  get stats() { return { threads: this.histories.size, bytes: this.bytes } }

  prune(): void {
    for (const [id, history] of this.histories) if (history.updatedAt + this.limits.ttlMs <= this.now()) this.remove(id)
    while (this.histories.size > this.limits.threads || this.bytes > this.limits.totalBytes) {
      const oldest = this.histories.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.remove(oldest)
    }
  }

  private read(threadId: string): History {
    this.prune()
    const history = this.histories.get(threadId)
    if (!history) throw new EphemeralHistoryError('Temporary conversation history has expired or was cleared.', 410, 'ephemeral_history_expired')
    this.touch(threadId, history)
    return history
  }

  private touch(id: string, history: History): void {
    history.updatedAt = this.now()
    this.histories.delete(id)
    this.histories.set(id, history)
  }

  capture(method: string, paramsValue: unknown): boolean {
    const params = record(paramsValue)
    const threadId = text(params?.threadId) || text(params?.thread_id)
    const history = this.histories.get(threadId)
    if (!history || !params) return false
    this.touch(threadId, history)
    const rawTurn = record(params.turn)
    const turnId = text(params.turnId) || text(params.turn_id) || text(rawTurn?.id)
    if (!turnId) return true
    let turn = history.turns.get(turnId)
    // Late replay must not recreate a turn already outside the retained window.
    if (!turn && method !== 'turn/started') return true
    if (!turn) {
      if (history.seenTurns.has(turnId)) return true
      history.seenTurns.add(turnId)
      while (history.seenTurns.size > this.limits.turns * 2) history.seenTurns.delete(history.seenTurns.values().next().value!)
      turn = { index: history.nextIndex++, status: 'inProgress', error: null, metadataBytes: 0, items: new Map(), truncated: false }
      history.turns.set(turnId, turn)
    }
    if (method === 'item/completed') this.storeItem(history, turn, record(params.item))
    if (method === 'turn/completed') {
      turn.status = text(rawTurn?.status) || 'completed'
      const error = rawTurn?.error ?? null
      const errorLimit = Math.min(4096, Math.floor(this.limits.threadBytes / 4))
      turn.error = estimateRetainedBytes(error, errorLimit) <= errorLimit ? error : { message: 'Turn error exceeded the temporary history preview limit.' }
      if (Array.isArray(rawTurn?.items)) for (const item of rawTurn.items) this.storeItem(history, turn, record(item))
    }
    const metadataBytes = estimateRetainedBytes({ id: turnId, status: turn.status, error: turn.error })
    history.bytes += metadataBytes - turn.metadataBytes
    this.bytes += metadataBytes - turn.metadataBytes
    turn.metadataBytes = metadataBytes
    while (history.turns.size > this.limits.turns || history.bytes > this.limits.threadBytes) {
      const oldest = history.turns.entries().next().value as [string, Turn] | undefined
      if (!oldest) break
      if (history.turns.size === 1) {
        const firstItem = oldest[1].items.entries().next().value as [string, Item] | undefined
        if (!firstItem) {
          history.bytes -= oldest[1].metadataBytes
          this.bytes -= oldest[1].metadataBytes
          history.turns.delete(oldest[0])
          history.truncated = true
          break
        }
        oldest[1].items.delete(firstItem[0])
        history.bytes -= firstItem[1].bytes
        this.bytes -= firstItem[1].bytes
        oldest[1].truncated = history.truncated = true
      } else {
        history.bytes -= oldest[1].metadataBytes
        this.bytes -= oldest[1].metadataBytes
        for (const item of oldest[1].items.values()) { history.bytes -= item.bytes; this.bytes -= item.bytes }
        history.turns.delete(oldest[0])
        history.truncated = true
      }
    }
    this.prune()
    return true
  }

  private storeItem(history: History, turn: Turn, item: Record<string, unknown> | null): void {
    const id = text(item?.id)
    if (!item || !id) return
    const previous = turn.items.get(id)
    if (previous) { history.bytes -= previous.bytes; this.bytes -= previous.bytes; turn.items.delete(id) }
    const bytes = estimateRetainedBytes(item, this.limits.threadBytes)
    if (bytes + turn.metadataBytes > this.limits.threadBytes) { turn.truncated = history.truncated = true; return }
    turn.items.set(id, { value: item, bytes })
    history.bytes += bytes
    this.bytes += bytes
  }

  page(threadId: string, beforeTurnId: string, afterTurnId: string, limit: number) {
    const history = this.read(threadId)
    const turns = [...history.turns.entries()]
    const anchor = beforeTurnId || afterTurnId
    const index = anchor ? turns.findIndex(([id]) => id === anchor) : turns.length
    if (anchor && index < 0) throw new EphemeralHistoryError('The temporary conversation window changed. Reload the latest messages.', 409, 'stale_window')
    const start = afterTurnId ? index + 1 : Math.max(0, index - limit)
    const end = afterTurnId ? Math.min(turns.length, start + limit) : index
    const latest = turns.at(-1)
    return {
      result: { thread: {
        id: threadId,
        status: { type: latest?.[1].status === 'inProgress' ? 'active' : 'idle' },
        turns: turns.slice(start, end).map(([id, turn]) => ({ id, status: turn.status, error: turn.error, items: [...turn.items.values()].map((item) => item.value) })),
      } },
      startTurnIndex: turns[start]?.[1].index ?? history.nextIndex,
      nextTurnIndex: history.nextIndex,
      hasMoreOlder: start > 0,
      hasMoreNewer: end < turns.length,
      historyTruncated: history.truncated,
      activeTurnId: latest?.[1].status === 'inProgress' ? latest[0] : '',
    }
  }

  item(threadId: string, turnId: string, itemId: string): Record<string, unknown> {
    const history = this.read(threadId)
    const item = history.turns.get(turnId)?.items.get(itemId)?.value
    if (!item) throw new EphemeralHistoryError('This message is outside the temporary history cache.', 410, 'ephemeral_source_expired')
    return item
  }
}
