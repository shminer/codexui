export function copyTextWithSelectionFallback(text: string, ownerDocument = typeof document === 'undefined' ? undefined : document): boolean {
  if (!ownerDocument) return false

  const previousFocus = ownerDocument.activeElement as HTMLElement | null
  const container = previousFocus?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? ownerDocument.body
  const textarea = ownerDocument.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  container.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return ownerDocument.execCommand('copy')
  } catch {
    return false
  } finally {
    container.removeChild(textarea)
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
}

export async function copyTextToClipboard(text: string, ownerDocument = typeof document === 'undefined' ? undefined : document): Promise<void> {
  const ownerNavigator = ownerDocument?.defaultView?.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator)
  if (ownerNavigator?.clipboard?.writeText) {
    try {
      await ownerNavigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back for embedded browser contexts without clipboard permission.
    }
  }

  if (!copyTextWithSelectionFallback(text, ownerDocument)) {
    throw new Error('Copy failed')
  }
}
