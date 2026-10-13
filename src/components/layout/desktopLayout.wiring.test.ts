import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

describe('desktop conversation split layout', () => {
  it('keeps the complete main column separate from the agent sidebar', async () => {
    const source = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    const template = descriptor.template!.ast!
    const desktop = template.children.find((node) => node.type === 1 && node.tag === 'DesktopLayout')
    if (!desktop || desktop.type !== 1) throw new Error('DesktopLayout missing')
    const contentSlot = desktop.children.find((node) => node.type === 1 && node.tag === 'template'
      && node.props.some((prop) => prop.type === 7 && prop.name === 'slot' && prop.arg?.type === 4 && prop.arg.content === 'content'))
    if (!contentSlot || contentSlot.type !== 1) throw new Error('Content slot missing')
    const root = contentSlot.children.find((node) => node.type === 1 && node.tag === 'section')
    if (!root || root.type !== 1) throw new Error('Content root missing')
    const children = root.children.filter((node) => node.type === 1)
    expect(children.map((node) => node.type === 1 ? node.tag : '')).toEqual(['div', 'ThreadSubagentPanel'])
    const main = children[0]!
    if (main.type !== 1) throw new Error('Main column missing')
    expect(main.props).toContainEqual(expect.objectContaining({ name: 'class', value: expect.objectContaining({ content: 'content-main-column' }) }))
    expect(main.children.some((node) => node.type === 1 && node.tag === 'ContentHeader')).toBe(true)
    expect(source).toContain(':min-main-width="subagentLayoutMinimum"')
    expect(source).toContain('MIN_DESKTOP_SPLIT_WIDTH : MIN_DESKTOP_THREAD_SPACE')
    expect(source).not.toContain('MIN_DESKTOP_THREAD_SPACE + DESKTOP_PANEL_COLLAPSED_WIDTH')
    expect(source).toContain('@request-desktop-expand="onRequestSubagentExpand"')
    expect(source).toContain('@desktop-expanded-change="isSubagentPanelExpanded = $event"')
    expect(source).toContain('threadSubagentPanelRef.value?.collapseDesktopPanel()')
    expect(source).toContain('.content-main-column :deep(.thread-composer:has(.thread-composer-input-wrap--expanded))')
  })

  it('limits only the displayed left width and starts dragging at that width', async () => {
    const source = await readFile(new URL('./DesktopLayout.vue', import.meta.url), 'utf8')
    expect(source).toContain('minMainWidth: 0')
    expect(source).toContain('calc(100% - ${props.minMainWidth}px - 1px)')
    expect(source).toContain('desktopSidebarRef.value?.getBoundingClientRect().width ?? sidebarWidth.value')
    expect(source).toContain('saveSidebarWidth(sidebarWidth.value)')
  })
})
