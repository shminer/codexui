import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadSideConversation wiring', () => {
  it('keeps popup pages responsive and avoids desktop window dimensions on mobile', async () => {
    const source = await readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain("isMobile.value ? undefined : 'popup,width=760,height=900'")
    expect(source).toContain("viewport.name = 'viewport'")
    expect(source).toContain("'width=device-width, initial-scale=1.0'")
    expect(source).toContain('popupDocument.head.appendChild(viewport)')
  })

  it('enables main composer capabilities by default and disables them explicitly in side chats', async () => {
    const composer = await readFile(new URL('./ThreadComposer.vue', import.meta.url), 'utf8')
    const side = await readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8')
    expect(composer).toContain('withDefaults(defineProps<')
    for (const capability of ['persistDraft', 'allowGoal', 'allowSideConversation']) {
      expect(composer).toContain(`${capability}: true`)
    }
    for (const capability of ['persist-draft', 'allow-goal', 'allow-side-conversation']) {
      expect(side).toContain(`:${capability}="false"`)
    }
  })

  it('minimizes without ending and keeps desktop drag and accessible resize wiring', async () => {
    const source = await readFile(new URL('./ThreadSideConversation.vue', import.meta.url), 'utf8')
    const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')

    expect(source).toContain('sendWithEnter?: boolean')
    expect(source).toContain('visible: boolean')
    expect(source).toContain('<ThreadComposer')
    expect(source).toContain('<QueuedMessages')
    expect(source).toContain(':in-progress-submit-mode="inProgressSubmitMode"')
    expect(source).toContain('minimize: []')
    expect(source).toContain('end: []')
    expect(source).toContain('send: [payload: SubmitPayload]')
    expect(source).toContain("t('Minimize side conversation')")
    expect(source).toContain("t('End side conversation')")
    expect(source).toContain('v-show="visible"')
    expect(source).not.toContain(':disabled="isOpening"')
    expect(source).toContain('@click.self="minimize"')
    expect(source).toContain("@click=\"emit('end')\"")
    expect(source).toContain("interrupt: []")
    expect(source).toContain('@interrupt="emit(\'interrupt\')"')
    expect(source).toContain('@pointerdown="onSideConversationHeaderPointerDown"')
    expect(source).toContain('@pointerdown="onSideConversationResizePointerDown"')
    expect(source).toContain('aria-orientation="vertical"')
    expect(source).toContain(':aria-valuemin="sideConversationWindowWidthRange.minimum"')
    expect(source).toContain(':aria-valuemax="sideConversationWindowWidthRange.maximum"')
    expect(source).toContain(':aria-valuenow="sideConversationWindow.width"')
    expect(source).toContain('tabindex="0"')
    expect(source).toContain('@keydown="onSideConversationResizeKeydown"')
    const resizeKeydownBody = source.match(/function onSideConversationResizeKeydown\(event: KeyboardEvent\): void \{([\s\S]*?)\n\}/u)?.[1] ?? ''
    expect(resizeKeydownBody).toContain("event.key === 'ArrowLeft'")
    expect(resizeKeydownBody).toContain("event.key === 'ArrowRight'")
    expect(resizeKeydownBody).toContain("event.key === 'ArrowUp'")
    expect(resizeKeydownBody).toContain("event.key === 'ArrowDown'")
    expect(resizeKeydownBody).toContain('clampTerminalWindowRect')
    expect(source).toContain('clampTerminalWindowRect')
    expect(source).toContain("window.addEventListener('pointermove', onSideConversationWindowPointerMove)")
    expect(source).toContain("window.removeEventListener('pointermove', onSideConversationWindowPointerMove)")
    expect(source).not.toContain('side-conversation-draft.v2.')
    expect(appSource).toContain(':send-with-enter="sendWithEnter"')
    expect(appSource).toContain(':side-conversation-open="isSideConversationVisible"')
    expect(appSource).toContain(':visible="isSideConversationVisible"')
    expect(appSource).toContain(':queued-messages="sideConversationQueuedMessages"')
    expect(appSource).toContain('@minimize="hideSideConversation"')
    expect(appSource).toContain('@end="endSideConversation"')
    expect(appSource).not.toContain('@close="endSideConversation"')
    expect(appSource).toContain('@send="onSubmitSideConversationMessage"')
    expect(appSource).toContain('@interrupt="interruptSideConversationTurn"')
    expect(appSource).toContain(':cwd="composerCwd"')
    expect(appSource).not.toContain('sideConversationCwd')
    expect(appSource).toContain('discardSideConversationInBackground()')
    expect(appSource).toContain('let accountStateRequestEpoch = 0')
    expect(appSource).toContain('requestEpoch !== accountStateRequestEpoch')
  })
})
