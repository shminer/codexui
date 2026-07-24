import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation mobile diff viewer wiring', () => {
  it('keeps the mobile close button outside the diff toolbar', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')

    expect(source).toContain('<button v-if="!isMobile" class="image-modal-close diff-viewer-close"')
    expect(source).toMatch(/<\/section>\s*<button\s+v-if="isMobile"\s+class="image-modal-close diff-viewer-close diff-viewer-mobile-close"/u)
    expect(source).toContain('.diff-viewer-mobile-close {\n  @apply absolute top-3 right-3 z-30;\n}')
    expect(source).toContain('@apply sticky top-0 z-10 bg-white px-3 py-3 pr-16;')
  })
})
