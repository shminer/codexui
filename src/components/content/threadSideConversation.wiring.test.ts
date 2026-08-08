import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadSideConversation wiring', () => {
  it('shares the global send shortcut and keeps navigation cleanup in the background', async () => {
    const source = await readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8')
    const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')

    expect(source).toContain('sendWithEnter?: boolean')
    expect(source).toContain('@keydown="onInputKeydown"')
    expect(source).toContain('shouldSubmitComposer(event, props.sendWithEnter)')
    expect(appSource).toContain(':send-with-enter="sendWithEnter"')
    expect(appSource).toMatch(/watch\(\s*\(\) => \[selectedThreadId\.value, sideConversationParentThreadId\.value\][\s\S]*?discardSideConversationInBackground\(\)[\s\S]*?\n\s*\},\s*\n\)/u)
  })
})
