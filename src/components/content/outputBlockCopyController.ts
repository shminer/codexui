import { copyTextToClipboard } from '../../utils/clipboard'

export type OutputBlockCopyState = {
  copied: boolean
  errorText: string
}

type CopyClick = Pick<Event, 'stopPropagation'> & Partial<Pick<Event, 'currentTarget'>>

export function createOutputBlockCopyController(options: {
  getCopyText: () => string
  onStateChange: (state: OutputBlockCopyState) => void
}) {
  let state: OutputBlockCopyState = { copied: false, errorText: '' }
  let resetTimer: ReturnType<typeof setTimeout> | null = null

  function publish(next: OutputBlockCopyState): void {
    state = next
    options.onStateChange({ ...state })
  }

  function clearResetTimer(): void {
    if (resetTimer === null) return
    clearTimeout(resetTimer)
    resetTimer = null
  }

  async function copyOutput(event: CopyClick): Promise<void> {
    event.stopPropagation()
    const ownerDocument = (event.currentTarget as Node | null)?.ownerDocument ?? undefined
    clearResetTimer()
    publish({ copied: false, errorText: '' })

    try {
      await copyTextToClipboard(options.getCopyText(), ownerDocument)
      publish({ copied: true, errorText: '' })
      resetTimer = setTimeout(() => {
        resetTimer = null
        publish({ copied: false, errorText: '' })
      }, 1500)
    } catch {
      publish({ copied: false, errorText: 'Copy failed' })
    }
  }

  return {
    get state(): OutputBlockCopyState {
      return { ...state }
    },
    copyOutput,
    dispose: clearResetTimer,
  }
}
