export function updatePinnedThreadIds(
  pinnedThreadIds: string[],
  threadId: string,
  pinned: boolean,
): string[] {
  const remaining = pinnedThreadIds.filter((id) => id !== threadId)
  return pinned ? [threadId, ...remaining] : remaining
}
