export const CHAT_WIDTH_MIN = 640
export const CHAT_WIDTH_MAX = 1920
export const CHAT_WIDTH_STEP = 16
export const CHAT_WIDTH_DEFAULT = 720
export const CHAT_WIDTH_KEY = 'codex-web-local.chat-width-px.v1'

export function normalizeChatWidth(value: number): number {
  if (!Number.isFinite(value)) return CHAT_WIDTH_DEFAULT
  const bounded = Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, value))
  return CHAT_WIDTH_MIN + Math.round((bounded - CHAT_WIDTH_MIN) / CHAT_WIDTH_STEP) * CHAT_WIDTH_STEP
}

export function loadChatWidthPref(): number {
  if (typeof window === 'undefined') return CHAT_WIDTH_DEFAULT
  try {
    const value = window.localStorage.getItem(CHAT_WIDTH_KEY)
    return value?.trim() ? normalizeChatWidth(Number(value)) : CHAT_WIDTH_DEFAULT
  } catch {
    return CHAT_WIDTH_DEFAULT
  }
}

export function saveChatWidthPref(value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHAT_WIDTH_KEY, String(normalizeChatWidth(value)))
  } catch {
    // Keep the live layout usable when browser storage is unavailable.
  }
}
