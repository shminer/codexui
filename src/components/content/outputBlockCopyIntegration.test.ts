import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation per-block copy integration', () => {
  it('adds copy controls only to fenced Markdown code blocks', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source.match(/<CopyableOutputBlock\b/gu)).toHaveLength(1)
    expect(source).toContain(':copy-text="block.value"')
    expect(source).toContain('label="Copy code block"')
    expect(source).not.toContain('messageBlockCopyText')
    expect(source).not.toContain('messageBlockCopyLabel')
  })

  it('does not add controls to prose, lists, plans, reasoning, errors, commands, images, or diffs', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/CopyableOutputBlock[^>]+(?:message\.text|step\.step|reasoningText|errorText|aggregatedOutput|block\.markdown|block\.url)/u)
    expect(source).not.toMatch(/(?:cmd-output|plan-card|live-overlay|diff-viewer)[\s\S]{0,240}<CopyableOutputBlock/u)
  })

  it('renders fenced code nested in list items through the recursive copyable block renderer', async () => {
    const conversationSource = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(conversationSource).toContain("import MessageBlockRenderer from './MessageBlockRenderer.vue'")
    expect(conversationSource.match(/<MessageBlockRenderer\s+:item="item"/gu)).toHaveLength(2)
    expect(conversationSource).not.toContain('v-html="renderListItemContentAsHtml(item)"')

    const rendererSource = await readFile(new URL('./MessageBlockRenderer.vue', import.meta.url), 'utf8')
    expect(rendererSource).toContain("block.kind === 'codeBlock'")
    expect(rendererSource).toContain(':copy-text="block.value"')
    expect(rendererSource).toContain('label="Copy code block"')
    expect(rendererSource).toContain('<MessageBlockRenderer')
    expect(rendererSource.match(/<CopyableOutputBlock\b/gu)).toHaveLength(1)
    expect(rendererSource).not.toMatch(/CopyableOutputBlock[^>]+(?:paragraph|item\.paragraphs|block\.items)/u)
  })
})

describe('CopyableOutputBlock interaction and responsive contract', () => {
  it('isolates clicks and exposes success and failure feedback accessibly', async () => {
    const source = await readFile(new URL('./CopyableOutputBlock.vue', import.meta.url), 'utf8')
    const button = source.match(/<button\s+[\s\S]*?@click\.stop="copyOutput"[\s\S]*?>/u)?.[0]
    const liveStatus = source.match(/<span\s+class="output-block-copy-status"\s+aria-live="polite">\{\{ errorText \}\}<\/span>/u)?.[0]
    expect(button).toBeDefined()
    expect(button).toContain(":aria-label=\"copied ? 'Copied' : label\"")
    expect(liveStatus).toBeDefined()
    expect(source).toContain('createOutputBlockCopyController')
  })

  it('keeps a 32px visible mobile target and reveals desktop controls on focus', async () => {
    const source = await readFile(new URL('./CopyableOutputBlock.vue', import.meta.url), 'utf8')
    expect(source).toContain('min-width: 32px')
    expect(source).toContain('min-height: 32px')
    expect(source).toContain('@media (hover: none), (pointer: coarse)')
    expect(source).toMatch(/@media \(hover: none\), \(pointer: coarse\)[\s\S]*opacity: 1[\s\S]*pointer-events: auto/u)
    expect(source).toContain('@media (hover: hover) and (pointer: fine)')
    expect(source).toContain('.output-block-copy-button:focus-visible')
  })
})
