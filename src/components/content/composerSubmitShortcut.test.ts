import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { shouldSubmitComposer } from './composerSubmitShortcut'

describe('shouldSubmitComposer', () => {
  it.each([
    ['enabled Enter', true, { key: 'Enter' }, true],
    ['enabled Shift+Enter', true, { key: 'Enter', shiftKey: true }, false],
    ['disabled Enter', false, { key: 'Enter' }, false],
    ['disabled Ctrl+Enter', false, { key: 'Enter', ctrlKey: true }, true],
    ['disabled Command+Enter', false, { key: 'Enter', metaKey: true }, true],
    ['IME Enter', true, { key: 'Enter', isComposing: true }, false],
    ['other key', true, { key: 'a' }, false],
  ])('%s', (_label, sendWithEnter, overrides, expected) => {
    expect(shouldSubmitComposer({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      isComposing: false,
      ...overrides,
    }, sendWithEnter)).toBe(expected)
  })
})

describe('ThreadComposer Goal budget wiring', () => {
  it('accepts a non-negative integer budget and emits null when it is empty', async () => {
    const source = await readFile(new URL('./ThreadComposer.vue', import.meta.url), 'utf8')

    expect(source).toContain('v-model="goalTokenBudgetDraft"')
    expect(source).toContain('type="number"')
    expect(source).toContain('min="0"')
    expect(source).toContain(':max="Number.MAX_SAFE_INTEGER"')
    expect(source).toContain("'save-goal': [objective: string, tokenBudget: number | null]")
    expect(source).toContain("emit('save-goal', objective, tokenBudget)")
    expect(source).toContain('const value = String(goalTokenBudgetDraft.value).trim()')
    expect(source).toContain('if (!value) return null')
    expect(source).toContain('Number.isSafeInteger(budget) && budget >= 0 ? budget : undefined')
  })
})
