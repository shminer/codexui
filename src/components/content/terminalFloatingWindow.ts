export type TerminalFloatingWindowRect = {
  left: number
  top: number
  width: number
  height: number
}

export type TerminalVisualViewport = {
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
}

const TERMINAL_WINDOW_MARGIN = 8
const DEFAULT_TERMINAL_WINDOW_WIDTH = 1200
const DEFAULT_TERMINAL_WINDOW_HEIGHT = 640
const MIN_TERMINAL_WINDOW_WIDTH = 240
const MIN_TERMINAL_WINDOW_HEIGHT = 200

export function initialTerminalWindowRect(viewport: TerminalVisualViewport): TerminalFloatingWindowRect {
  const width = Math.min(DEFAULT_TERMINAL_WINDOW_WIDTH, availableWindowWidth(viewport))
  const height = Math.min(DEFAULT_TERMINAL_WINDOW_HEIGHT, availableWindowHeight(viewport))
  return clampTerminalWindowRect({
    left: viewport.offsetLeft + Math.round((viewport.width - width) / 2),
    top: viewport.offsetTop + TERMINAL_WINDOW_MARGIN,
    width,
    height,
  }, viewport)
}

export function clampTerminalWindowRect(
  rect: TerminalFloatingWindowRect,
  viewport: TerminalVisualViewport,
): TerminalFloatingWindowRect {
  const availableWidth = availableWindowWidth(viewport)
  const availableHeight = availableWindowHeight(viewport)
  const width = clampValue(rect.width, Math.min(MIN_TERMINAL_WINDOW_WIDTH, availableWidth), availableWidth)
  const height = clampValue(rect.height, Math.min(MIN_TERMINAL_WINDOW_HEIGHT, availableHeight), availableHeight)
  const minimumLeft = viewport.offsetLeft + TERMINAL_WINDOW_MARGIN
  const minimumTop = viewport.offsetTop + TERMINAL_WINDOW_MARGIN
  return {
    left: clampValue(rect.left, minimumLeft, Math.max(minimumLeft, viewport.offsetLeft + viewport.width - TERMINAL_WINDOW_MARGIN - width)),
    top: clampValue(rect.top, minimumTop, Math.max(minimumTop, viewport.offsetTop + viewport.height - TERMINAL_WINDOW_MARGIN - height)),
    width,
    height,
  }
}

function availableWindowWidth(viewport: TerminalVisualViewport): number {
  return Math.max(1, viewport.width - (TERMINAL_WINDOW_MARGIN * 2))
}

function availableWindowHeight(viewport: TerminalVisualViewport): number {
  return Math.max(1, viewport.height - (TERMINAL_WINDOW_MARGIN * 2))
}

function clampValue(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : minimum
  return Math.min(maximum, Math.max(minimum, normalized))
}
