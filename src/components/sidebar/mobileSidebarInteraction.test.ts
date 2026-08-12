import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

type CssBlock = {
  body: string
  end: number
  start: number
}

function extractCssBlock(source: string, header: string): CssBlock {
  const start = source.indexOf(header)
  if (start < 0) throw new Error(`Missing CSS block: ${header}`)
  const openingBrace = source.indexOf('{', start + header.length)
  if (openingBrace < 0) throw new Error(`Missing opening brace: ${header}`)

  let depth = 0
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) {
      return {
        body: source.slice(openingBrace + 1, index),
        end: index + 1,
        start,
      }
    }
  }
  throw new Error(`Missing closing brace: ${header}`)
}

function removeCssBlocks(source: string, blocks: CssBlock[]): string {
  return [...blocks]
    .sort((left, right) => right.start - left.start)
    .reduce((result, block) => `${result.slice(0, block.start)}${result.slice(block.end)}`, source)
}

function extractThreadRows(source: string): string[] {
  return source.match(/<SidebarMenuRow\b(?=[^>]*class="thread-row")[\s\S]*?<\/SidebarMenuRow>/gu) ?? []
}

describe('mobile sidebar interaction policy', () => {
  it('contains every hover/focus slot swap inside the fine-pointer block', async () => {
    const source = await readFile(new URL('./SidebarMenuRow.vue', import.meta.url), 'utf8')
    const fine = extractCssBlock(source, '@media (hover: hover) and (pointer: fine)')
    const coarse = extractCssBlock(source, '@media (hover: none), (pointer: coarse)')
    const outsideCapabilityBlocks = removeCssBlocks(source, [fine, coarse])

    expect(fine.body).toContain(":hover .sidebar-menu-row-right-default")
    expect(fine.body).toContain(":focus-within .sidebar-menu-row-right-default")
    expect(fine.body).toContain(":hover .sidebar-menu-row-right-hover")
    expect(fine.body).toContain(":focus-within .sidebar-menu-row-right-hover")
    expect(fine.body).toContain('@apply opacity-0 invisible pointer-events-none;')
    expect(fine.body).toContain('@apply opacity-100 visible pointer-events-auto;')
    expect(outsideCapabilityBlocks).not.toMatch(/:(?:hover|focus-within)[^{]*\.sidebar-menu-row-right-(?:default|hover)\s*\{/u)
  })

  it('renders overflow directly on coarse pointers without hover-dependent selectors', async () => {
    const source = await readFile(new URL('./SidebarMenuRow.vue', import.meta.url), 'utf8')
    const coarse = extractCssBlock(source, '@media (hover: none), (pointer: coarse)')

    expect(coarse.body).toContain("[data-has-right-hover='true'] .sidebar-menu-row-right-default")
    expect(coarse.body).toContain('@apply opacity-0 invisible pointer-events-none;')
    expect(coarse.body).toContain("[data-has-right='true'] .sidebar-menu-row-right-hover")
    expect(coarse.body).toContain('@apply static translate-y-0 opacity-100 visible pointer-events-auto;')
    expect(coarse.body).not.toMatch(/:(?:hover|focus-within)/u)
  })

  it('keeps status hiding and delete reveal inside fine pointers while confirmation stays unconditional', async () => {
    const source = await readFile(new URL('./SidebarThreadTree.vue', import.meta.url), 'utf8')
    const fine = extractCssBlock(source, '@media (hover: hover) and (pointer: fine)')
    const outsideFinePointers = removeCssBlocks(source, [fine])

    expect(fine.body).toContain('.thread-row:hover .thread-delete-button')
    expect(fine.body).toContain('.thread-row:focus-within .thread-delete-button')
    expect(fine.body).toMatch(/\.thread-row:hover \.thread-status-indicator[\s\S]*@apply opacity-0;/u)
    expect(fine.body).toContain('.thread-row:focus-within .thread-status-indicator')
    expect(outsideFinePointers).not.toMatch(/\.thread-row:(?:hover|focus-within) \.thread-status-indicator/u)
    expect(outsideFinePointers).not.toMatch(/\.thread-row:(?:hover|focus-within) \.thread-delete-button/u)

    const confirmingRule = extractCssBlock(outsideFinePointers, ".thread-delete-button[data-confirming='true']")
    expect(confirmingRule.body).toContain('opacity-100')
    expect(confirmingRule.body).toContain('pointer-events-auto')
  })

  it('wires all four thread row variants to isolated main and overflow actions', async () => {
    const source = await readFile(new URL('./SidebarThreadTree.vue', import.meta.url), 'utf8')
    const rows = extractThreadRows(source)

    expect(rows).toHaveLength(4)
    for (const row of rows) {
      const rowOpeningTag = row.slice(0, row.indexOf('>') + 1)
      const mainButton = row.match(/<button\b(?=[^>]*class="thread-main-button")[^>]*>/u)?.[0]
      const overflowButton = row.match(/<button\b(?=[^>]*class="thread-menu-trigger")[^>]*>/u)?.[0]

      expect(rowOpeningTag).not.toContain('@click')
      expect(mainButton).toContain('@click.stop="onThreadMainClick(thread.id)"')
      expect(overflowButton).toContain('@click.stop="onThreadOverflowClick(thread.id)"')
      expect(row.match(/@click\.stop="onThreadMainClick\(thread\.id\)"/gu)).toHaveLength(1)
      expect(row.match(/@click\.stop="onThreadOverflowClick\(thread\.id\)"/gu)).toHaveLength(1)
      expect(row).not.toContain('@click="onSelect(thread.id)"')
      expect(row).not.toContain('@click.stop="onSelect(thread.id)"')
      expect(row).not.toContain('@click.stop="toggleThreadMenu(thread.id)"')
    }
  })

  it('selects exactly once for a main action and never opens overflow', async () => {
    const { dispatchThreadRowInteraction } = await import('./threadRowInteraction')
    const calls = { overflow: [] as string[], select: [] as string[] }

    dispatchThreadRowInteraction('main', 'thread-main', {
      onOverflow: (threadId) => calls.overflow.push(threadId),
      onSelect: (threadId) => calls.select.push(threadId),
    })

    expect(calls).toEqual({ overflow: [], select: ['thread-main'] })
  })

  it('opens overflow exactly once and never selects for an overflow action', async () => {
    const { dispatchThreadRowInteraction } = await import('./threadRowInteraction')
    const calls = { overflow: [] as string[], select: [] as string[] }

    dispatchThreadRowInteraction('overflow', 'thread-menu', {
      onOverflow: (threadId) => calls.overflow.push(threadId),
      onSelect: (threadId) => calls.select.push(threadId),
    })

    expect(calls).toEqual({ overflow: ['thread-menu'], select: [] })
  })

  it('waits for unpin success only when archiving a pinned thread', async () => {
    const source = await readFile(new URL('./SidebarThreadTree.vue', import.meta.url), 'utf8')
    const start = source.indexOf('async function deleteThreadById')
    const end = source.indexOf('\nfunction openAutomationDialog', start)
    const deleteBlock = source.slice(start, end)

    expect(deleteBlock).toContain('if (!await unpinThreadBeforeArchive(')
    expect(deleteBlock).toContain('(id) => queuePinnedThreadUpdate(id, false)')
    expect(deleteBlock.indexOf('await unpinThreadBeforeArchive')).toBeLessThan(deleteBlock.indexOf("emit('archive', threadId)"))
  })

  it('commits each bounded pinned-summary batch before loading the next batch', async () => {
    const source = await readFile(new URL('./SidebarThreadTree.vue', import.meta.url), 'utf8')
    const start = source.indexOf('async function hydrateMissingPinnedThreads')
    const end = source.indexOf('\nwatch([pinnedThreadIds', start)
    const hydrationBlock = source.slice(start, end)

    expect(hydrationBlock).toContain('await loadPinnedThreadSummaryBatches(')
    expect(hydrationBlock).toContain('hydratedPinnedThreadById.value = next')
    expect(hydrationBlock.indexOf('hydratedPinnedThreadById.value = next')).toBeLessThan(hydrationBlock.indexOf('return true'))
  })

  it('prunes hydrated summaries only from the authoritative pinned-thread state', async () => {
    const source = await readFile(new URL('./SidebarThreadTree.vue', import.meta.url), 'utf8')
    const start = source.indexOf('async function refreshPinnedThreadState')
    const end = source.indexOf('\nfunction queuePinnedThreadUpdate', start)
    const refreshBlock = source.slice(start, end)

    expect(refreshBlock).toContain('const nextPinnedThreadIdSet = new Set(nextPinnedThreadIds)')
    expect(refreshBlock).toContain('if (pinnedThreadIdsChanged) pinnedThreadIds.value = nextPinnedThreadIds')
    expect(refreshBlock).toContain('Object.entries(hydratedPinnedThreadById.value).filter(([threadId]) => nextPinnedThreadIdSet.has(threadId))')
    expect(refreshBlock).not.toContain('threadById.value')
  })
})
