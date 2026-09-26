import { ref } from 'vue'
import type { UiMessage } from '../../types/codex'
import { copyTextToClipboard, copyTextWithSelectionFallback } from '../../utils/clipboard'

export function isCopyableUserMessage(message: UiMessage): boolean {
  return message.role === 'user' && message.text.trim().length > 0
}

export function createMessageCopyController(options: {
  getThreadId: () => string
  getResponseText: (messageId: string) => string | undefined
}) {
  const expandedUserMessageId = ref('')
  const copiedMessageId = ref('')
  let resetTimer: ReturnType<typeof setTimeout> | null = null
  let copyGeneration = 0

  function toggleUserMessageCopy(message: UiMessage): void {
    if (!isCopyableUserMessage(message)) return
    expandedUserMessageId.value = expandedUserMessageId.value === message.id ? '' : message.id
  }

  function onUserMessageTextClick(message: UiMessage, event: MouseEvent): void {
    if (!isCopyableUserMessage(message)) return
    if (event.target instanceof Element && event.target.closest('a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]')) return
    if (window.getSelection()?.isCollapsed === false) return
    toggleUserMessageCopy(message)
  }

  function showCopyMessageButton(message: UiMessage): boolean {
    if (message.role === 'user') return isCopyableUserMessage(message) && expandedUserMessageId.value === message.id
    return typeof options.getResponseText(message.id) === 'string'
  }

  async function copyMessage(message: UiMessage): Promise<void> {
    const content = message.role === 'user' ? message.text : options.getResponseText(message.id) ?? ''
    if (!content) return
    const threadIdAtStart = options.getThreadId()
    const generationAtStart = ++copyGeneration
    if (message.role === 'user') copiedMessageId.value = ''

    let copied = false
    try {
      await copyTextToClipboard(content)
      copied = true
    } catch {
      if (generationAtStart !== copyGeneration || options.getThreadId() !== threadIdAtStart) return
      copied = copyTextWithSelectionFallback(content)
    }

    if (!copied || generationAtStart !== copyGeneration || options.getThreadId() !== threadIdAtStart) return
    copiedMessageId.value = message.id
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copiedMessageId.value = ''
      resetTimer = null
    }, 1800)
  }

  function reset(): void {
    copyGeneration += 1
    expandedUserMessageId.value = ''
    copiedMessageId.value = ''
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = null
  }

  return { expandedUserMessageId, copiedMessageId, toggleUserMessageCopy, onUserMessageTextClick, showCopyMessageButton, copyMessage, reset }
}
