import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation render-window wiring', () => {
  it('places live status beside only the current turn steering', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('const steeringIndex = props.liveOverlay.turnId ? rows.findIndex')
    expect(source).toContain('message?.turnId === props.liveOverlay?.turnId')
  })
  it('virtualizes stable message IDs and keeps loaded data independent of mounted rows', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('<DynamicScroller')
    expect(source).toContain('<ConversationVirtualRow :item="item" :index="index" :active="active"')
    expect(source).toContain(':shift="true"')
    expect(source).toContain(':disable-transform="true"')
    expect(source).toContain(':buffer="400"')
    expect(source).toContain('renderableMessages.value.map((message) => ({ id: message.id, message }))')
    expect(source).toContain('return filterRenderableThreadMessages(messages, hiddenCommands, hiddenChanges)')
    expect(source).toContain('hiddenCommands.delete(searchTargetId.value)')
    expect(source).toContain('hiddenChanges.delete(searchTargetId.value)')
    expect(source).not.toContain('renderWindowStart')
    expect(source).not.toContain('searchWindowEnd')
    expect(source).toContain("scrollToItem(index, { align: 'center' })")
  })

  it('waits for successful latest navigation and stops paging at capacity without a clear action', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const jump = source.match(/async function jumpToLatest\(\): Promise<void> \{([\s\S]*?)\n\}/u)?.[1] ?? ''
    expect(source).not.toContain('releaseHistory')
    expect(source).not.toContain('conversation-capacity')
    expect(jump).toContain('await props.loadLatestMessages(threadId)')
    expect(jump.indexOf('await props.loadLatestMessages(threadId)')).toBeLessThan(jump.indexOf('autoFollowOutput.value = true'))
    expect(jump.indexOf("throw new Error('Latest message window is not available.')")).toBeLessThan(jump.indexOf('autoFollowOutput.value = true'))
    expect(source).toContain('props.historyCapacityReached || isLoadingMore.value')
    expect(source).toContain("if (!direction || (paginationIntent !== direction && paginationIntent !== 'either')) return")
    expect(source).toContain('paginationIntent = null')
  })

  it('keeps same-thread history refreshes manual and requests latest only on explicit thread changes', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('const autoFollowOutput = ref(!props.isHistoryWindow && !props.hasMorePersistedBelow)')
    expect(source).toContain('return autoFollowOutput.value && !props.isHistoryWindow && !props.hasMorePersistedBelow')
    const historyWatcher = source.match(/watch\(\s*\(\) => props.isHistoryWindow \|\| props.hasMorePersistedBelow,([\s\S]*?)\n\)/u)?.[1] ?? ''
    expect(historyWatcher).toContain('if (historyWindow) autoFollowOutput.value = false')
    expect(historyWatcher).not.toContain('autoFollowOutput.value = true')
    expect(historyWatcher).not.toContain('jumpToLatest')
    const threadWatcher = source.match(/watch\(\s*\(\) => props.activeThreadId,([\s\S]*?)\n\)/u)?.[1] ?? ''
    expect(threadWatcher).toContain('await jumpToLatest()')
    expect(threadWatcher).toContain('autoFollowOutput.value = !props.isHistoryWindow && !props.hasMorePersistedBelow')
    expect(source).toContain('container.scrollTop > previousTop && resumeFollowingAtBottom()')
    expect(source).toContain('!autoFollowOutput.value && !conversationAtBottom.value')
    expect(source).toContain('@scrollend="onConversationScrollEnd"')
    expect(source).not.toContain('@scroll-end=')
  })

  it('removes history status wiring from the conversation, composer and side window', async () => {
    const [conversation, app, side, composer] = await Promise.all([
      readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8'),
      readFile(new URL('../../App.vue', import.meta.url), 'utf8'),
      readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8'),
      readFile(new URL('./ThreadComposer.vue', import.meta.url), 'utf8'),
    ])
    for (const source of [conversation, app, side, composer]) {
      expect(source).not.toContain('historyStatusTarget')
      expect(source).not.toContain('threadHistoryStatusTarget')
      expect(source).not.toContain('history-status-target')
      expect(source).not.toContain('name="history-status"')
      expect(source).not.toContain('#history-status')
    }
    expect(composer).toContain('v-if="turnThroughputText" class="thread-composer-status-row"')
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

  it('reserves space below newer pagination for the floating jump control', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('class="conversation-load-more conversation-load-more-later"')
    expect(source).toMatch(/\.conversation-load-more-later\s*\{\s*@apply pb-20;/u)
  })
})
