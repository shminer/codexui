import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation user message copy', () => {
  it('keeps rich text semantics and exposes a native keyboard and screen-reader toggle', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const textFlow = source.match(/<div\s+v-else\s+class="message-text-flow"[\s\S]*?>/u)?.[0]
    expect(textFlow).toContain('@click="onUserMessageTextClick(message, $event)"')
    expect(textFlow).not.toMatch(/(?:role|tabindex|aria-expanded|@keydown)=/u)
    const toggle = source.match(/<button\s+v-if="isCopyableUserMessage\(message\)"[\s\S]*?>/u)?.[0]
    expect(toggle).toContain('type="button"')
    expect(toggle).toContain(':aria-expanded="expandedUserMessageId === message.id"')
    expect(toggle).toContain('@click="toggleUserMessageCopy(message)"')
    expect(source).toContain('.user-message-copy-toggle:focus')
    expect(source).toContain("import { createMessageCopyController, isCopyableUserMessage } from './messageCopyController'")
    expect(source).toContain('getThreadId: () => props.activeThreadId')
    expect(source).toContain('getResponseText: (messageId) => copyableResponseContentByAnchorId.value[messageId]')
    expect(source).toContain('@click="copyMessage(message)"')
  })

  it('clears session state and keeps the revealed toolbar visible with stable mobile targets', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const threadWatch = source.slice(source.indexOf('  () => props.activeThreadId,'), source.indexOf('function onConversationScroll('))
    expect(threadWatch).toContain('messageCopy.reset()')
    expect(source.slice(source.indexOf('onBeforeUnmount(() => {'))).toContain('messageCopy.reset()')
    expect(source).toContain(".message-toolbar[data-copy-expanded='true']")
    expect(source).toContain('.message-toolbar:focus-within')
    expect(source).toContain('min-width: 60px')
    expect(source).toContain('min-height: 32px')
    const styles = await readFile(new URL('../../style.css', import.meta.url), 'utf8')
    expect(styles).toContain(':root.dark .message-copy-button {')
    expect(styles).toContain(":root.dark .message-copy-button[data-copied='true'] {")
  })
})
