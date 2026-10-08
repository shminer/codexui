import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ThreadConversation render-window wiring', () => {
  it('clamps visible messages and enters manual history mode before expansion', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    expect(source).toContain('const effectiveRenderWindowStart = computed(() => clampThreadRenderWindowStart(')
    expect(source).toContain('return filterRenderableThreadMessages(messages, hiddenCommands, hiddenChanges)')
    expect(source).toContain('hiddenCommands.delete(searchTargetId.value)')
    expect(source).toContain('hiddenChanges.delete(searchTargetId.value)')
    expect(source).toContain('if (message.id !== searchTargetId.value || !isFileChangeMessage(message)) return null')
    expect(source).toContain('renderableMessages.value.slice(effectiveRenderWindowStart.value, searchWindowEnd.value)')
    expect(source).toContain('searchWindowEnd.value = renderWindowStart.value + 50')
    expect(source).not.toContain('props.messages.slice(effectiveRenderWindowStart.value)')
    expect(source).toMatch(/async function loadMoreAbove[\s\S]*autoFollowOutput\.value = false[\s\S]*earlierThreadRenderWindowStart/u)
  })

  it('restores the bounded latest window only when jumping to latest', async () => {
    const source = await readFile(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')
    const jumpToLatestBody = source.match(/function jumpToLatest\(\): void \{([\s\S]*?)\n\}/u)?.[1]
    expect(jumpToLatestBody).toBeDefined()
    expect(jumpToLatestBody).toContain('autoFollowOutput.value = true')
    expect(jumpToLatestBody).toContain('latestThreadRenderWindowStart(renderableMessages.value.length)')
  })
})
