type ComposerKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing'>

export function shouldSubmitComposer(event: ComposerKeyEvent, sendWithEnter?: boolean): boolean {
  if (event.isComposing || event.key !== 'Enter') return false
  return sendWithEnter !== false
    ? !event.shiftKey
    : event.metaKey || event.ctrlKey
}
