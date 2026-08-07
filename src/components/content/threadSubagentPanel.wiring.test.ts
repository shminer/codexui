import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadSubagentPanel desktop sidebar wiring', () => {
  it('keeps the desktop agent sidebar resizable, collapsible, and persisted', async () => {
    const source = await readFile(new URL('./ThreadSubagentPanel.vue', import.meta.url), 'utf8')

    expect(source).toContain('class="subagent-panel-host"')
    expect(source).toContain('class="subagent-panel-resizer"')
    expect(source).toContain('role="separator"')
    expect(source).toContain('aria-orientation="vertical"')
    expect(source).toContain('tabindex="0"')
    expect(source).toContain(':aria-valuemin="MIN_DESKTOP_PANEL_WIDTH"')
    expect(source).toContain(':aria-valuemax="desktopPanelMaximum"')
    expect(source).toContain(':aria-valuenow="desktopPanelRenderedWidth"')
    expect(source).toContain('@pointerdown="onDesktopResizePointerDown"')
    expect(source).toContain('@keydown="onDesktopResizerKeyDown"')
    expect(source).toContain("codex-web-local.subagent-panel-width.v1")
    expect(source).toContain("codex-web-local.subagent-panel-collapsed.v1")
    expect(source).toContain('setPointerCapture(event.pointerId)')
    expect(source).toContain("addEventListener('lostpointercapture', onDesktopResizePointerCaptureLost)")
    expect(source).toContain("window.addEventListener('blur', onDesktopResizeWindowBlur)")
    expect(source).toContain("window.removeEventListener('pointercancel', onDesktopResizePointerEnd)")
    expect(source).toContain('new ResizeObserver(onDesktopLayoutResize)')
    expect(source).toContain('desktopLayoutResizeObserver?.disconnect()')
    expect(source).toContain('is-desktop-collapsed')
    expect(source).not.toContain('subagent-panel-footer')
    expect(source).toContain('@click="toggleSubagentPanel"')
    const toggleBody = source.match(/function toggleDesktopPanel\(\): void \{([\s\S]*?)\n\}/u)?.[1] ?? ''
    expect(toggleBody).not.toContain('getThreadDetail')
    expect(source).not.toMatch(/<aside\s+v-if=/u)
  })

  it('keeps mobile sheet behavior separate and allows desktop details to shrink', async () => {
    const source = await readFile(new URL('./ThreadSubagentPanel.vue', import.meta.url), 'utf8')

    expect(source).toContain('const activeAgents = computed')
    const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')

    expect(source).toContain('v-if="activeAgents.length > 0 && (!isMobile || !mobileSheetOpen)"')
    expect(source).toContain('v-for="(agent, index) in activeAgents"')
    expect(source).toContain('if (!activeAgents.value.some((agent) => agent.threadId === threadId)) return')
    expect(source).toMatch(/watch\(\s*activeAgents,[\s\S]*closeDetail\(\)/u)
    expect(source).not.toContain('void selectAgent(threadId)')
    expect(source).toContain('<Teleport to="#thread-subagent-header-target">')
    expect(source).toContain('class="subagent-header-trigger"')
    expect(appSource).toContain('id="thread-subagent-header-target"')
    expect(source).toContain('<Teleport to="body" :disabled="!isMobile || !mobileSheetOpen">')
    expect(source).toContain('if (agents.length === 0) mobileSheetOpen.value = false')
    expect(source).toContain('.subagent-panel.is-mobile-open')
    expect(source).toContain('@media (max-width: 767px)')
    expect(source).toMatch(/\.subagent-panel-surface\s*\{[\s\S]*min-w-0[\s\S]*w-full/u)
    expect(source).toMatch(/@media \(max-width: 767px\)[\s\S]*\.subagent-panel-host\s*\{[\s\S]*display:\s*contents/u)
  })
})
