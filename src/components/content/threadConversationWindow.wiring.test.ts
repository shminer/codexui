import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation render-window wiring', () => {
  it('clamps visible messages and enters manual history mode before expansion', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('const effectiveRenderWindowStart = computed(() => clampThreadRenderWindowStart(')
    expect(source).toContain('return filterRenderableThreadMessages(messages, hiddenCommands, hiddenChanges)')
    expect(source).toContain('hiddenCommands.delete(searchTargetId.value)')
    expect(source).toContain('hiddenChanges.delete(searchTargetId.value)')
    expect(source).toContain('if (message.id !== searchTargetId.value || !isFileChangeMessage(message)) return null')
    expect(source).toContain('renderableMessages.value.slice(effectiveRenderWindow.value.start, effectiveRenderWindow.value.end)')
    expect(source).toContain('searchWindowEnd.value = renderWindowStart.value + 50')
    expect(source).not.toContain('props.messages.slice(effectiveRenderWindowStart.value)')
    expect(source).toContain("function loadMoreAbove(): Promise<void> { return moveHistoryWindow('earlier') }")
    expect(source).toContain("function loadMoreBelow(): Promise<void> { return moveHistoryWindow('later') }")
    expect(source).toContain('restoreConversationAnchor(anchor)')
    expect(source).toContain('row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset')
  })

  it('restores the bounded latest window only when jumping to latest', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const jumpToLatestBody = source.match(/async function jumpToLatest\(\): Promise<void> \{([\s\S]*?)\n\}/u)?.[1]
    expect(jumpToLatestBody).toBeDefined()
    expect(jumpToLatestBody).toContain('autoFollowOutput.value = true')
    expect(jumpToLatestBody).toContain('setLatestRenderWindow()')
    expect(jumpToLatestBody!.indexOf('await props.loadLatestMessages(threadId)')).toBeLessThan(jumpToLatestBody!.indexOf("searchTargetId.value = ''"))
  })

  it('unmounts collapsed command details and skips streaming snapshots in long-lived caches', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('getGroupedCommandsForLatest(message).length > 0 && isCommandGroupExpanded(message)')
    expect(source).toContain('v-if="isCommandExpanded(cmd)"')
    expect(source).toContain('v-if="isCommandExpanded(message)"')
    expect(source).toContain('COMMAND_PAGE_SIZE = 30')
    expect(source).toContain('new BoundedRenderCache<string, MessageBlockCacheEntry>()')
    expect(source).toContain("if ((message.messageType ?? '').endsWith('.live')) return blocks")
    expect(source).toContain('100 - (Date.now() - lastStreamRenderAt)')
  })
})
