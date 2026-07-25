export const DEFAULT_DESKTOP_PANEL_WIDTH = 480
export const MIN_DESKTOP_PANEL_WIDTH = 280
export const MAX_DESKTOP_PANEL_WIDTH = 960

const MIN_DESKTOP_THREAD_SPACE = 332

export function clampDesktopPanelWidth(value: number, maximum = MAX_DESKTOP_PANEL_WIDTH): number {
  const upperBound = Math.max(MIN_DESKTOP_PANEL_WIDTH, Math.min(MAX_DESKTOP_PANEL_WIDTH, maximum))
  const normalized = Number.isFinite(value) ? Math.round(value) : DEFAULT_DESKTOP_PANEL_WIDTH
  return Math.min(upperBound, Math.max(MIN_DESKTOP_PANEL_WIDTH, normalized))
}

export function maximumDesktopPanelWidth(layoutWidth: number): number {
  return Math.max(
    MIN_DESKTOP_PANEL_WIDTH,
    Math.min(MAX_DESKTOP_PANEL_WIDTH, Math.floor(layoutWidth - MIN_DESKTOP_THREAD_SPACE)),
  )
}

export function effectiveDesktopPanelWidth(preferredWidth: number, layoutWidth: number): number {
  return clampDesktopPanelWidth(preferredWidth, maximumDesktopPanelWidth(layoutWidth))
}

export function desktopPanelWidthAfterDrag(
  startWidth: number,
  startClientX: number,
  clientX: number,
  layoutWidth: number,
): number {
  return clampDesktopPanelWidth(
    startWidth + startClientX - clientX,
    maximumDesktopPanelWidth(layoutWidth),
  )
}

export function readStoredDesktopPanelWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_DESKTOP_PANEL_WIDTH
  return clampDesktopPanelWidth(Number(raw))
}
