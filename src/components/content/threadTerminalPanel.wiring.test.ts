import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadTerminalPanel floating terminal wiring', () => {
  it('keeps the terminal draggable, resizable, and equipped with one-shot shortcuts', async () => {
    const source = await readFile(new URL('./ThreadTerminalPanel.vue', import.meta.url), 'utf8')

    expect(source).toMatch(/<Teleport to="body">\s*<section\s+class="thread-terminal-panel"/u)
    expect(source).toContain('thread-terminal-shortcuts')
    expect(source).toContain('onTerminalHeaderPointerDown')
    expect(source).toContain('onTerminalResizePointerDown')
    expect(source).toContain('ctrlShortcutArmed.value = false')
    expect(source).toContain('terminalCtrlKeyboardInput(data)')
    expect(source).toContain('terminalVirtualKeyInput(key, false)')
    expect(source).toContain('lastResizedTerminalGrid')
    expect(source).toContain('setPointerCapture(event.pointerId)')
    expect(source).toContain('lostpointercapture')
    expect(source).toContain("window.addEventListener('blur', onTerminalWindowBlur)")
  })

  it('activates the selected terminal before its attach response and ignores stale responses', async () => {
    const source = await readFile(new URL('./ThreadTerminalPanel.vue', import.meta.url), 'utf8')

    expect(source).toMatch(/function onSelectTab\(tabId: string\): void \{[\s\S]*activeSessionId\.value = tabId[\s\S]*terminal\?\.clear\(\)[\s\S]*attachToThread\(false, tabId\)/u)
    expect(source).toContain('let latestAttachRequest = 0')
    expect(source).toContain('if (requestId !== latestAttachRequest) return')
  })
})
