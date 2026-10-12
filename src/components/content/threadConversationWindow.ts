export const THREAD_RENDER_WINDOW_SIZE = 50
export const THREAD_RENDER_LOAD_CHUNK = 30
export const THREAD_RENDER_HISTORY_LIMIT = 100

export type ThreadRenderWindow = { start: number; end: number }

export function historyScrollDirection(previousTop: number, top: number, height: number, viewport: number, threshold: number): 'earlier' | 'later' | null {
  if (top < previousTop && top < threshold) return 'earlier'
  if (top > previousTop && height - top - viewport < threshold) return 'later'
  return null
}

export function clampThreadRenderWindow(start: number, end: number, messageCount: number): ThreadRenderWindow {
  const count = Math.max(0, Math.floor(messageCount))
  if (count === 0) return { start: 0, end: 0 }
  const boundedStart = clampThreadRenderWindowStart(start, count)
  const boundedEnd = Math.min(count, Math.max(boundedStart + 1, Number.isFinite(end) ? Math.floor(end) : count))
  return { start: boundedStart, end: Math.min(boundedEnd, boundedStart + THREAD_RENDER_HISTORY_LIMIT) }
}

export function earlierThreadRenderWindow(start: number, end: number, messageCount: number): ThreadRenderWindow {
  const current = clampThreadRenderWindow(start, end, messageCount)
  const nextStart = earlierThreadRenderWindowStart(current.start, messageCount)
  return { start: nextStart, end: Math.min(current.end, nextStart + THREAD_RENDER_HISTORY_LIMIT) }
}

export function laterThreadRenderWindow(start: number, end: number, messageCount: number): ThreadRenderWindow {
  const current = clampThreadRenderWindow(start, end, messageCount)
  const nextEnd = Math.min(Math.max(0, Math.floor(messageCount)), current.end + THREAD_RENDER_LOAD_CHUNK)
  return { start: Math.max(current.start, nextEnd - THREAD_RENDER_HISTORY_LIMIT), end: nextEnd }
}

export function filterRenderableThreadMessages<T extends { id: string }>(
  messages: readonly T[],
  ...hiddenMessageIdSets: ReadonlySet<string>[]
): T[] {
  return messages.filter((message) =>
    hiddenMessageIdSets.every((hiddenMessageIds) => !hiddenMessageIds.has(message.id)),
  )
}

export function clampThreadRenderWindowStart(start: number, messageCount: number): number {
  const boundedCount = Math.max(0, Math.floor(messageCount))
  if (boundedCount === 0) return 0
  const normalizedStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0
  return Math.min(normalizedStart, boundedCount - 1)
}

export function latestThreadRenderWindowStart(messageCount: number): number {
  return Math.max(0, Math.floor(messageCount) - THREAD_RENDER_WINDOW_SIZE)
}

export function earlierThreadRenderWindowStart(start: number, messageCount: number): number {
  const effectiveStart = clampThreadRenderWindowStart(start, messageCount)
  return Math.max(0, effectiveStart - THREAD_RENDER_LOAD_CHUNK)
}
