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
