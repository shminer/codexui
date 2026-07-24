import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation mobile diff viewer wiring', () => {
  it('keeps the diff viewer and its toolbar close button above the content header', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')

    expect(source).toMatch(
      /<Teleport to="body">\s*<div v-if="activeDiffViewerChange" class="diff-viewer-backdrop"/u,
    )
    expect(source).toContain('<button class="image-modal-close diff-viewer-close"')
    expect(source).not.toContain('diff-viewer-mobile-close')
    expect(source).toContain('@apply fixed inset-0 z-[300] bg-black/45')
    expect(source).toContain('@apply sticky top-0 z-10 bg-white px-3 py-3;')
  })
})
