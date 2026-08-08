import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadSideConversation wiring', () => {
  it('shares the global send shortcut and keeps navigation cleanup in the background', async () => {
    const source = await readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8')
    const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')

    expect(source).toContain('sendWithEnter?: boolean')
    expect(source).toContain('props.sendWithEnter !== false')
    expect(source).toContain("event.key === 'Enter' && (event.metaKey || event.ctrlKey)")
    expect(appSource).toContain(':send-with-enter="sendWithEnter"')
    expect(appSource).toContain('discardSideConversationInBackground()')
  })
})
