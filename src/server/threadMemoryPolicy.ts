export function estimateRetainedBytes(value: unknown, stopAfter = Number.POSITIVE_INFINITY): number {
  const visited = new Set<object>()
  const pending: unknown[] = [value]
  let bytes = 0
  while (pending.length && bytes <= stopAfter) {
    const item = pending.pop()
    if (typeof item === 'string') bytes += item.length * 2
    else if (item && typeof item === 'object' && !visited.has(item)) {
      visited.add(item)
      bytes += 32
      for (const [key, child] of Object.entries(item)) {
        bytes += key.length * 2 + 16
        pending.push(child)
      }
    } else bytes += 8
  }
  return bytes
}

type RetainedEntry = { threadId: string; bytes: number; expiresAt: number; lastUsed: number; evict: () => void }

export class ThreadCacheBudget {
  private readonly entries = new Map<string, RetainedEntry>()
  private bytes = 0
  private accessOrder = 0

  constructor(private readonly maxThreads = 8, private readonly maxBytes = 32 * 1024 * 1024) {}

  retain(key: string, threadId: string, value: unknown, ttlMs: number, evict: () => void): void {
    this.forget(key)
    const bytes = estimateRetainedBytes(value, this.maxBytes)
    if (bytes > this.maxBytes) {
      evict()
      return
    }
    this.entries.set(key, { threadId, bytes, expiresAt: Date.now() + ttlMs, lastUsed: ++this.accessOrder, evict })
    this.bytes += bytes
    this.prune()
  }

  touch(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.expiresAt <= Date.now()) {
      this.remove(key)
      return
    }
    this.entries.delete(key)
    entry.lastUsed = ++this.accessOrder
    this.entries.set(key, entry)
  }

  forget(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.bytes -= entry.bytes
    this.entries.delete(key)
  }

  prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key)
    while (this.bytes > this.maxBytes || new Set([...this.entries.values()].map((entry) => entry.threadId)).size > this.maxThreads) {
      const latestAccessByThread = new Map<string, number>()
      for (const entry of this.entries.values()) latestAccessByThread.set(entry.threadId, Math.max(entry.lastUsed, latestAccessByThread.get(entry.threadId) ?? 0))
      const oldest = [...latestAccessByThread].sort((first, second) => first[1] - second[1])[0]?.[0]
      if (oldest === undefined) break
      for (const [key, entry] of this.entries) if (entry.threadId === oldest) this.remove(key)
    }
  }

  clear(): void {
    for (const key of this.entries.keys()) this.remove(key)
  }

  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.forget(key)
    entry.evict()
  }
}

export function diagnosticPreview(value: unknown, maxCharacters = 16 * 1024): { value: unknown; truncated: boolean } {
  let remaining = maxCharacters
  let nodes = 512
  let truncated = false
  const visited = new Set<object>()
  const copy = (item: unknown, depth: number): unknown => {
    if (--nodes < 0 || depth > 12 || remaining <= 0) {
      truncated = true
      return null
    }
    if (typeof item === 'string') {
      const text = item.length > remaining ? item.slice(0, remaining).split('').join('') : item
      remaining -= text.length
      truncated ||= text.length < item.length
      return text
    }
    if (!item || typeof item !== 'object') return item
    if (visited.has(item)) {
      truncated = true
      return null
    }
    visited.add(item)
    if (Array.isArray(item)) {
      const result: unknown[] = []
      for (const child of item) {
        if (nodes <= 0 || remaining <= 0) { truncated = true; break }
        result.push(copy(child, depth + 1))
      }
      return result
    }
    const result: Record<string, unknown> = {}
    const priorityKeys = ['threadId', 'thread_id', 'turnId', 'turn_id', 'id', 'status', 'willRetry', 'error', 'message', 'turn']
    const keys = [...priorityKeys.filter((key) => Object.prototype.hasOwnProperty.call(item, key)), ...Object.keys(item).filter((key) => !priorityKeys.includes(key))]
    for (const key of keys) {
      if (nodes <= 0 || remaining <= key.length) { truncated = true; break }
      remaining -= key.length
      result[key] = copy((item as Record<string, unknown>)[key], depth + 1)
    }
    return result
  }
  return { value: copy(value, 0), truncated }
}

export class ThreadDiagnosticBuffer<T> {
  private readonly threads = new Map<string, { events: { frame: T; bytes: number }[]; bytes: number; updatedAt: number }>()
  private bytes = 0

  add(threadId: string, frame: T): void {
    let thread = this.threads.get(threadId)
    if (!thread) thread = { events: [], bytes: 0, updatedAt: 0 }
    this.threads.delete(threadId)
    this.threads.set(threadId, thread)
    const bytes = estimateRetainedBytes(frame)
    thread.events.push({ frame, bytes })
    thread.bytes += bytes
    this.bytes += bytes
    thread.updatedAt = Date.now()
    while (thread.events.length > 128) {
      const removed = thread.events.shift()!
      thread.bytes -= removed.bytes
      this.bytes -= removed.bytes
    }
    this.prune()
  }

  get(threadId: string, limit: number): T[] {
    this.prune()
    return this.threads.get(threadId)?.events.slice(-limit).map((event) => event.frame) ?? []
  }

  prune(): void {
    for (const [threadId, thread] of this.threads) {
      if (thread.updatedAt + 5 * 60_000 <= Date.now()) this.remove(threadId)
    }
    while (this.threads.size > 8 || this.bytes > 4 * 1024 * 1024) {
      const oldest = this.threads.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.remove(oldest)
    }
  }

  clear(): void {
    this.threads.clear()
    this.bytes = 0
  }

  remove(threadId: string): void {
    const thread = this.threads.get(threadId)
    if (!thread) return
    this.bytes -= thread.bytes
    this.threads.delete(threadId)
  }
}

export { commandOutputPage } from '../commandOutput'
