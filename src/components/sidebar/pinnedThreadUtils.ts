export function updatePinnedThreadIds(
  pinnedThreadIds: string[],
  threadId: string,
  pinned: boolean,
): string[] {
  const remaining = pinnedThreadIds.filter((id) => id !== threadId)
  return pinned ? [threadId, ...remaining] : remaining
}

export async function unpinThreadBeforeArchive(
  threadId: string,
  pinned: boolean,
  unpin: (threadId: string) => Promise<boolean>,
): Promise<boolean> {
  return !pinned || await unpin(threadId)
}

export async function loadPinnedThreadSummaryBatches<T>(
  threadIds: string[],
  batchSize: number,
  load: (threadId: string) => Promise<T>,
  commit: (loaded: Array<{ threadId: string; thread: T | null }>) => boolean,
): Promise<void> {
  for (let index = 0; index < threadIds.length; index += batchSize) {
    const loaded = await Promise.all(
      threadIds.slice(index, index + batchSize).map(async (threadId) => {
        try {
          return { threadId, thread: await load(threadId) }
        } catch {
          return { threadId, thread: null }
        }
      }),
    )
    if (!commit(loaded)) return
  }
}
