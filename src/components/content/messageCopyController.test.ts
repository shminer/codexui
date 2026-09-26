import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiMessage } from '../../types/codex'
import { copyTextToClipboard, copyTextWithSelectionFallback } from '../../utils/clipboard'
import { createMessageCopyController, isCopyableUserMessage } from './messageCopyController'

vi.mock('../../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
  copyTextWithSelectionFallback: vi.fn(),
}))

class TextTarget {
  closest = vi.fn((_selector: string): object | null => null)
}

const user: UiMessage = { id: 'user-1', role: 'user', text: '  first\nsecond  ' }
const assistant: UiMessage = { id: 'assistant', role: 'assistant', text: 'partial' }
let threadId: string
let selectionCollapsed: boolean
let controller: ReturnType<typeof createMessageCopyController>

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(copyTextToClipboard).mockReset().mockResolvedValue(undefined)
  vi.mocked(copyTextWithSelectionFallback).mockReset().mockReturnValue(false)
  threadId = 'thread-1'
  selectionCollapsed = true
  vi.stubGlobal('Element', TextTarget)
  vi.stubGlobal('window', { getSelection: () => ({ isCollapsed: selectionCollapsed }) })
  controller = createMessageCopyController({
    getThreadId: () => threadId,
    getResponseText: (id) => id === assistant.id ? 'Combined response\nfile diff' : undefined,
  })
})

afterEach(() => {
  controller.reset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('message copy interaction', () => {
  it('opens, closes, and switches the active user message without edit capability', () => {
    const other = { ...user, id: 'user-2' }
    expect(controller.showCopyMessageButton(user)).toBe(false)
    controller.toggleUserMessageCopy(user)
    expect(controller.showCopyMessageButton(user)).toBe(true)
    controller.toggleUserMessageCopy(user)
    expect(controller.showCopyMessageButton(user)).toBe(false)
    controller.toggleUserMessageCopy(user)
    controller.toggleUserMessageCopy(other)
    expect(controller.showCopyMessageButton(user)).toBe(false)
    expect(controller.showCopyMessageButton(other)).toBe(true)
    for (const message of [assistant, { ...user, text: ' \n ' }, { ...user, text: '', images: ['image.png'] }]) {
      expect(isCopyableUserMessage(message)).toBe(false)
      controller.toggleUserMessageCopy(message)
      expect(controller.expandedUserMessageId.value).toBe(other.id)
    }
  })

  it('leaves selection and nested controls alone while ordinary text clicks toggle Copy', () => {
    const target = new TextTarget()
    const event = { target } as unknown as MouseEvent
    selectionCollapsed = false
    controller.onUserMessageTextClick(user, event)
    expect(controller.expandedUserMessageId.value).toBe('')
    selectionCollapsed = true
    target.closest.mockReturnValue({})
    controller.onUserMessageTextClick(user, event)
    expect(controller.expandedUserMessageId.value).toBe('')
    expect(target.closest).toHaveBeenCalledWith('a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]')
    target.closest.mockReturnValue(null)
    controller.onUserMessageTextClick(user, event)
    expect(controller.expandedUserMessageId.value).toBe(user.id)
    controller.onUserMessageTextClick(user, event)
    expect(controller.expandedUserMessageId.value).toBe('')
    // Native button activation does not depend on the document selection.
    selectionCollapsed = false
    controller.toggleUserMessageCopy(user)
    expect(controller.expandedUserMessageId.value).toBe(user.id)
  })

  it('copies exact user text and resets feedback after 1800ms', async () => {
    await controller.copyMessage(user)
    expect(copyTextToClipboard).toHaveBeenCalledWith('  first\nsecond  ')
    expect(copyTextWithSelectionFallback).not.toHaveBeenCalled()
    expect(controller.copiedMessageId.value).toBe(user.id)
    await vi.advanceTimersByTimeAsync(1799)
    expect(controller.copiedMessageId.value).toBe(user.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.copiedMessageId.value).toBe('')
  })

  it.each([false, true])('reports success only if a rejected clipboard write has a successful fallback (%s)', async (fallbackSucceeds) => {
    await controller.copyMessage(user)
    vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('Copy failed'))
    vi.mocked(copyTextWithSelectionFallback).mockReturnValue(fallbackSucceeds)
    await controller.copyMessage(user)
    expect(copyTextWithSelectionFallback).toHaveBeenCalledWith(user.text)
    expect(controller.copiedMessageId.value).toBe(fallbackSucceeds ? user.id : '')
  })

  it('preserves combined assistant copy independently of the user toggle', async () => {
    expect(controller.showCopyMessageButton(assistant)).toBe(true)
    await controller.copyMessage(assistant)
    expect(copyTextToClipboard).toHaveBeenCalledWith('Combined response\nfile diff')
    expect(controller.copiedMessageId.value).toBe(assistant.id)
  })

  it.each([false, true])('discards a pending copy after leaving and returning to the thread (reject=%s)', async (reject) => {
    let finish!: () => void
    let fail!: (error: Error) => void
    vi.mocked(copyTextToClipboard).mockReturnValueOnce(new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }))
    controller.toggleUserMessageCopy(user)
    const pending = controller.copyMessage(user)
    threadId = 'thread-2'
    controller.reset()
    threadId = 'thread-1'
    if (reject) fail(new Error('late copy failure'))
    else finish()
    await pending
    expect(controller.expandedUserMessageId.value).toBe('')
    expect(controller.copiedMessageId.value).toBe('')
    expect(copyTextWithSelectionFallback).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps newer copy feedback when an older write completes later and clears it on disposal', async () => {
    let finishOld!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValueOnce(new Promise<void>((resolve) => { finishOld = resolve }))
    const oldCopy = controller.copyMessage(user)
    const other = { ...user, id: 'user-2' }
    await controller.copyMessage(other)
    finishOld()
    await oldCopy
    expect(controller.copiedMessageId.value).toBe(other.id)
    expect(vi.getTimerCount()).toBe(1)
    controller.reset()
    expect(controller.copiedMessageId.value).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })
})
