import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { readComposerSubmitShortcut, resolveComposerSteerAction } from './composerSubmitShortcut'

describe('readComposerSubmitShortcut', () => {
  it.each([
    ['enabled Enter', true, { key: 'Enter' }, 'default'],
    ['enabled Shift+Enter', true, { key: 'Enter', shiftKey: true }, null],
    ['enabled Ctrl+Enter', true, { key: 'Enter', ctrlKey: true }, 'steer'],
    ['enabled Command+Enter', true, { key: 'Enter', metaKey: true }, 'steer'],
    ['disabled Enter', false, { key: 'Enter' }, null],
    ['disabled Ctrl+Enter', false, { key: 'Enter', ctrlKey: true }, 'steer'],
    ['disabled Command+Enter', false, { key: 'Enter', metaKey: true }, 'steer'],
    ['repeated Enter', true, { key: 'Enter', repeat: true }, 'default'],
    ['repeated Ctrl+Enter', true, { key: 'Enter', ctrlKey: true, repeat: true }, null],
    ['IME Ctrl+Enter', true, { key: 'Enter', ctrlKey: true, isComposing: true }, null],
    ['other key', true, { key: 'a' }, null],
  ])('%s', (_label, sendWithEnter, overrides, expected) => {
    expect(readComposerSubmitShortcut({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      isComposing: false,
      repeat: false,
      ...overrides,
    }, sendWithEnter)).toBe(expected)
  })
})

describe('resolveComposerSteerAction', () => {
  it.each([
    ['sendable draft', { canSubmit: true }, 'submit-draft'],
    ['empty composer with queue', { hasQueue: true }, 'steer-first-queued'],
    ['empty composer without queue', {}, null],
    ['non-sendable draft with queue', { hasUnsavedDraft: true, hasQueue: true }, null],
    ['pending attachment with queue', { hasPendingAttachments: true, hasQueue: true }, null],
    ['disabled interaction with queue', { interactionDisabled: true, hasQueue: true }, null],
  ])('%s', (_label, overrides, expected) => {
    expect(resolveComposerSteerAction({
      canSubmit: false,
      hasUnsavedDraft: false,
      hasPendingAttachments: false,
      interactionDisabled: false,
      hasQueue: false,
      ...overrides,
    })).toBe(expected)
  })
})

describe('main composer steer shortcut wiring', () => {
  it('steers the first queued message through the existing queue action', async () => {
    const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')

    expect(appSource).toContain('@steer-first-queued-message="onSteerFirstQueuedMessage"')
    expect(appSource).toContain('const message = selectedThreadQueuedMessages.value[0]')
    expect(appSource).toContain('if (message) void steerQueuedMessage(message.id)')
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

describe('ThreadComposer cumulative token usage wiring', () => {
  it('shows the current thread total in the add menu and preserves the unknown state', async () => {
    const source = await readFile(new URL('./ThreadComposer.vue', import.meta.url), 'utf8')

    expect(source).toContain('class="thread-composer-token-usage"')
    expect(source).toContain("const totalTokens = props.threadTokenUsage?.total.totalTokens")
    expect(source).toContain('formatCompactTokenCount(totalTokens)')
    expect(source).toContain("t('Awaiting data')")
    expect(source).toContain("t('Cumulative thread usage')")
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
  })

  it('keeps prefill, decode, and average throughput in the existing status line', async () => {
    const source = await readFile(new URL('./ThreadComposer.vue', import.meta.url), 'utf8')

    expect(source.match(/class="thread-composer-throughput"/gu)).toHaveLength(1)
    expect(source).toContain('PF tps`')
    expect(source).toContain('dec tps`')
    expect(source).toContain('avg TPS`')
    expect(source).toContain('otks · ${rates.join')
    expect(source.match(/formatCompactTokenCount\(.+?\/ \(.+? \/ 1000\)\)/gu)).toHaveLength(3)
  })
})
