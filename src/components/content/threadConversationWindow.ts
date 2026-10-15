export function historyScrollDirection(previousTop: number, top: number, height: number, viewport: number, threshold: number): 'earlier' | 'later' | null {
  if (top < previousTop && top < threshold) return 'earlier'
  if (top > previousTop && height - top - viewport < threshold) return 'later'
  return null
}

export function filterRenderableThreadMessages<T extends { id: string }>(
  messages: readonly T[],
  ...hiddenMessageIdSets: ReadonlySet<string>[]
): T[] {
  return messages.filter((message) =>
    hiddenMessageIdSets.every((hiddenMessageIds) => !hiddenMessageIds.has(message.id)),
  )
}
