type ComposerKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing' | 'repeat'>

export type ComposerSubmitShortcut = 'default' | 'steer' | null
export type ComposerSteerAction = 'submit-draft' | 'steer-first-queued' | null

export function readComposerSubmitShortcut(event: ComposerKeyEvent, sendWithEnter?: boolean): ComposerSubmitShortcut {
  if (event.isComposing || event.key !== 'Enter') return null
  if (event.metaKey || event.ctrlKey) return event.repeat ? null : 'steer'
  return sendWithEnter !== false && !event.shiftKey ? 'default' : null
}

export function resolveComposerSteerAction(options: {
  canSubmit: boolean
  hasUnsavedDraft: boolean
  hasPendingAttachments: boolean
  interactionDisabled: boolean
  hasQueue: boolean
}): ComposerSteerAction {
  if (options.canSubmit) return 'submit-draft'
  if (
    !options.hasUnsavedDraft
    && !options.hasPendingAttachments
    && !options.interactionDisabled
    && options.hasQueue
  ) return 'steer-first-queued'
  return null
}
