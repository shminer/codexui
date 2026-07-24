import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation mobile file-change summary wiring', () => {
  it('shows a close icon for each expanded mobile changed-files summary', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')

    expect(source.match(/:aria-expanded="isFileChangeSummaryExpanded\(message\)"/gu)).toHaveLength(2)
    expect(source.match(/:aria-label="isMobile && isFileChangeSummaryExpanded\(message\) \? 'Close changed files' : undefined"/gu)).toHaveLength(2)
    expect(source.match(/v-if="isMobile && isFileChangeSummaryExpanded\(message\)"/gu)).toHaveLength(2)
    expect(source.match(/<IconTablerX\b[^>]*v-if="isMobile && isFileChangeSummaryExpanded\(message\)"[^>]*class="icon-svg file-change-summary-close-icon"/gu)).toHaveLength(2)
  })
})
