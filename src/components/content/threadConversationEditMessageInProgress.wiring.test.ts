import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation edit-message in-progress wiring', () => {
  it('hides and ignores edits while the selected turn is active', async () => {
    const [conversationSource, appSource] = await Promise.all([
      readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8'),
      readFile(new URL('../../App.vue', import.meta.url), 'utf8'),
    ])
    const conversationUsage = appSource.match(/<ThreadConversation\b[\s\S]*?\/>/u)?.[0]

    expect(conversationSource).toContain('isTurnInProgress?: boolean')
    expect(conversationSource).toContain('!props.readonly && !props.isTurnInProgress')
    expect(conversationSource).toContain('if (props.readonly || props.isTurnInProgress) return')
    expect(conversationUsage).toContain(':is-turn-in-progress="isSelectedThreadInProgress"')
  })
})
