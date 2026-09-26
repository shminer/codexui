import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation user message copy', () => {
  it('reveals Copy from the user text flow with keyboard access and memo invalidation', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const textFlow = source.match(/<div\s+v-else\s+class="message-text-flow"[\s\S]*?>/u)?.[0]
    expect(textFlow).toContain('@click="toggleUserMessageCopy(message, $event)"')
    expect(textFlow).toContain('@keydown="toggleUserMessageCopy(message, $event)"')
    expect(textFlow).toContain(':tabindex="isCopyableUserMessage(message) ? 0 : undefined"')
    expect(textFlow).toContain(':aria-expanded="isCopyableUserMessage(message) ? expandedUserMessageId === message.id : undefined"')
    expect(textFlow).toContain('expandedUserMessageId === message.id, props.cwd')
    expect(source).toContain("return message.role === 'user' && message.text.trim().length > 0")
    expect(source).toContain("expandedUserMessageId.value = expandedUserMessageId.value === message.id ? '' : message.id")
    expect(source).toContain('if (message.role === \'user\') return isCopyableUserMessage(message) && expandedUserMessageId.value === message.id')
  })

  it('preserves selection, nested controls, and copy access independent of edit permissions', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const handlers = source.slice(source.indexOf('function isCopyableUserMessage('), source.indexOf('function showForkResponseButton('))
    expect(handlers).toContain("event.target.closest('a, button, input, textarea, select, summary, [role=\"button\"], [contenteditable=\"true\"]')")
    expect(handlers).toContain('if (window.getSelection()?.isCollapsed === false) return')
    expect(handlers).toContain("event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)")
    expect(handlers).not.toMatch(/props\.(readonly|canRollback|isTurnInProgress)/u)
  })

  it('copies exact user text through the existing clipboard flow and retains assistant copy', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const copy = source.slice(source.indexOf('async function copyMessage('), source.indexOf('function forkResponse('))
    expect(copy).toContain("message.role === 'user' ? message.text : copyableResponseContentByAnchorId.value[anchorMessageId] ?? ''")
    expect(copy).toContain('await copyTextToClipboard(content)')
    expect(copy).toContain('copied = copyTextWithSelectionFallback(content)')
    expect(copy).toContain("if (message.role === 'user') copiedResponseAnchorId.value = ''")
    expect(copy).toContain('if (!copied || props.activeThreadId !== threadIdAtStart) return')
    expect(copy).toContain('}, 1800)')
    expect(source).toContain('@click="copyMessage(message)"')
  })

  it('clears session state and keeps the revealed toolbar visible with stable mobile targets', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const threadWatch = source.slice(source.indexOf('  () => props.activeThreadId,'), source.indexOf('function onConversationScroll('))
    expect(threadWatch).toContain("expandedUserMessageId.value = ''")
    expect(threadWatch).toContain("copiedResponseAnchorId.value = ''")
    expect(threadWatch).toContain('clearTimeout(copiedMessageResetTimer)')
    expect(source).toContain(".message-toolbar[data-copy-expanded='true']")
    expect(source).toContain('.message-toolbar:focus-within')
    expect(source).toContain('min-width: 60px')
    expect(source).toContain('min-height: 32px')
    const styles = await readFile(new URL('../../style.css', import.meta.url), 'utf8')
    expect(styles).toContain(':root.dark .message-copy-button {')
    expect(styles).toContain(":root.dark .message-copy-button[data-copied='true'] {")
  })
})
