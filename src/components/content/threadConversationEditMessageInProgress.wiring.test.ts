import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation edit-message in-progress wiring', () => {
  it('copies user text into the composer without changing the thread', async () => {
    const [conversationSource, appSource] = await Promise.all([
      readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8'),
      readFile(new URL('../../App.vue', import.meta.url), 'utf8'),
    ])
    const conversationUsage = appSource.match(/<ThreadConversation\b[\s\S]*?\/>/u)?.[0]

    expect(conversationSource).toContain("return !props.readonly && message.role === 'user' && message.text.trim().length > 0")
    expect(conversationSource).toContain("emit('editMessage', message.text)")
    expect(conversationUsage).toContain('@edit-message="onEditMessage"')
    expect(conversationUsage).not.toContain(':is-turn-in-progress=')
    expect(conversationUsage).not.toContain(':can-rollback=')
    expect(conversationUsage).not.toContain('@rollback=')
    expect(appSource).toContain('function onEditMessage(text: string): void {')
    expect(appSource).toContain('threadComposerRef.value?.appendTextToDraft(text)')
    expect(appSource).not.toContain('rollbackSelectedThread')
  })
})
