import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '../../utils/clipboard'
import { createOutputBlockCopyController } from './outputBlockCopyController'

vi.mock('../../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
}))

describe('output block copy controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(copyTextToClipboard).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('isolates the click, copies through the clipboard helper, and resets Copied after 1500ms', async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue()
    const stopPropagation = vi.fn()
    const states: Array<{ copied: boolean; errorText: string }> = []
    const controller = createOutputBlockCopyController({
      getCopyText: () => 'exact source',
      onStateChange: (state) => states.push({ ...state }),
    })

    await controller.copyOutput({ stopPropagation })

    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(copyTextToClipboard).toHaveBeenCalledOnce()
    expect(copyTextToClipboard).toHaveBeenCalledWith('exact source', undefined)
    expect(states.at(-1)).toEqual({ copied: true, errorText: '' })

    await vi.advanceTimersByTimeAsync(1499)
    expect(states.at(-1)).toEqual({ copied: true, errorText: '' })
    await vi.advanceTimersByTimeAsync(1)
    expect(states.at(-1)).toEqual({ copied: false, errorText: '' })
  })

  it('publishes the aria-live failure state when both clipboard paths reject', async () => {
    vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('Copy failed'))
    const states: Array<{ copied: boolean; errorText: string }> = []
    const controller = createOutputBlockCopyController({
      getCopyText: () => 'still available',
      onStateChange: (state) => states.push({ ...state }),
    })

    await controller.copyOutput({ stopPropagation: vi.fn() })

    expect(states.at(-1)).toEqual({ copied: false, errorText: 'Copy failed' })
    expect(controller.state).toEqual({ copied: false, errorText: 'Copy failed' })
  })

  it('copies in the document of a popup button', async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue()
    const ownerDocument = {} as Document
    const controller = createOutputBlockCopyController({ getCopyText: () => 'popup code', onStateChange: vi.fn() })
    await controller.copyOutput({ stopPropagation: vi.fn(), currentTarget: { ownerDocument } as unknown as EventTarget })
    expect(copyTextToClipboard).toHaveBeenCalledWith('popup code', ownerDocument)
    controller.dispose()
  })
})
