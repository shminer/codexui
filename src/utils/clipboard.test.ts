import { describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard, copyTextWithSelectionFallback } from './clipboard'

function setupClipboard(inDialog: boolean) {
  let parent: 'body' | 'dialog' | null = null
  let selected = false
  let range: [number, number] | undefined
  const dialog = {
    appendChild: vi.fn(() => { parent = 'dialog' }),
    removeChild: vi.fn(() => { parent = null }),
  }
  const button = {
    isConnected: true,
    closest: vi.fn(() => inDialog ? dialog : null),
    focus: vi.fn(() => { activeElement = button }),
  }
  let activeElement: unknown = button
  const textarea = {
    value: '',
    style: {} as CSSStyleDeclaration,
    setAttribute: vi.fn(),
    // Model a modal focus trap: focusing a textarea outside the dialog returns focus to its button.
    focus: vi.fn(() => { activeElement = inDialog && parent !== 'dialog' ? button : textarea }),
    select: vi.fn(() => { selected = true }),
    setSelectionRange: vi.fn((start: number, end: number) => { range = [start, end] }),
  }
  const document = {
    get activeElement() { return activeElement },
    defaultView: { navigator: { clipboard: undefined as { writeText: ReturnType<typeof vi.fn> } | undefined } },
    body: {
      appendChild: vi.fn(() => { parent = 'body' }),
      removeChild: vi.fn(() => { parent = null }),
    },
    createElement: vi.fn(() => textarea),
    execCommand: vi.fn(() => activeElement === textarea && selected && range?.[1] === textarea.value.length),
  }
  return { document: document as unknown as Document, owner: document, dialog, button, textarea }
}

describe('clipboard selection fallback', () => {
  it('keeps the fallback in the modal when the Clipboard API is missing', async () => {
    const test = setupClipboard(true)
    await expect(copyTextToClipboard('flowchart LR\n  A-->B', test.document)).resolves.toBeUndefined()
    expect(test.dialog.appendChild).toHaveBeenCalledWith(test.textarea)
    expect(test.owner.body.appendChild).not.toHaveBeenCalled()
    expect(test.owner.execCommand).toHaveBeenCalledWith('copy')
    expect(test.dialog.removeChild).toHaveBeenCalledWith(test.textarea)
    expect(test.owner.activeElement).toBe(test.button)
  })

  it('copies in the popup modal after a Clipboard API rejection', async () => {
    const test = setupClipboard(true)
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
    test.owner.defaultView.navigator.clipboard = { writeText }
    await expect(copyTextToClipboard('popup diagram', test.document)).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledWith('popup diagram')
    expect(test.dialog.appendChild).toHaveBeenCalledWith(test.textarea)
    expect(test.owner.body.appendChild).not.toHaveBeenCalled()
    expect(test.button.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('uses the document body outside a modal and restores the original focus', () => {
    const test = setupClipboard(false)
    expect(copyTextWithSelectionFallback('ordinary code', test.document)).toBe(true)
    expect(test.owner.body.appendChild).toHaveBeenCalledWith(test.textarea)
    expect(test.owner.body.removeChild).toHaveBeenCalledWith(test.textarea)
    expect(test.owner.activeElement).toBe(test.button)
  })

  it('removes the fallback textarea and restores focus even when copying throws', () => {
    const test = setupClipboard(true)
    test.owner.execCommand.mockImplementation(() => { throw new Error('Copy failed') })
    expect(copyTextWithSelectionFallback('diagram', test.document)).toBe(false)
    expect(test.dialog.removeChild).toHaveBeenCalledWith(test.textarea)
    expect(test.owner.activeElement).toBe(test.button)
  })
})
