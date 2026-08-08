import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadSideConversation wiring', () => {
  it('shares the global send shortcut and closes as an ephemeral side conversation', async () => {
    const source = await readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8')
    const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')

    expect(source).toContain('sendWithEnter?: boolean')
    expect(source).toContain('@keydown="onInputKeydown"')
    expect(source).toContain('shouldSubmitComposer(event, props.sendWithEnter)')
    expect(source).toContain('function requestClose(): void')
    expect(source).toContain("function requestClose(): void {\n  emit('close')\n}")
    expect(source).not.toContain(':disabled="isOpening"')
    expect(source).toContain('@click.self="requestClose"')
    expect(source).toContain('@click="requestClose"')
    expect(source).toContain("interrupt: []")
    expect(source).toContain('side-conversation-action--stop')
    expect(source).not.toContain('side-conversation-draft.v2.')
    expect(source).not.toContain("t('End chat')")
    expect(appSource).toContain(':send-with-enter="sendWithEnter"')
    expect(appSource).toContain('@close="closeSideConversation"')
    expect(appSource).toContain('@interrupt="interruptSideConversationTurn"')
    expect(appSource).toContain(':cwd="sideConversationCwd"')
    expect(appSource).toContain('discardSideConversationInBackground()')
    expect(appSource).toContain('let accountStateRequestEpoch = 0')
    expect(appSource).toContain('requestEpoch !== accountStateRequestEpoch')
    expect(appSource).not.toContain('@hide="hideSideConversation"')
    expect(appSource).not.toContain('@end="endSideConversation"')
  })
})
