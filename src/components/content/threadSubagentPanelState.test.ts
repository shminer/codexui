import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_PANEL_WIDTH,
  desktopPanelWidthAfterDrag,
  effectiveDesktopPanelWidth,
  maximumDesktopPanelWidth,
  readStoredDesktopPanelWidth,
} from './threadSubagentPanelState'

describe('desktop subagent sidebar width', () => {
  it('grows when dragged left, shrinks when dragged right, and preserves parent space', () => {
    expect(desktopPanelWidthAfterDrag(480, 500, 400, 1440)).toBe(580)
    expect(desktopPanelWidthAfterDrag(480, 500, 600, 1440)).toBe(380)
    expect(desktopPanelWidthAfterDrag(480, 500, -500, 763)).toBe(431)
    expect(desktopPanelWidthAfterDrag(480, 500, 1000, 763)).toBe(280)
  })

  it('normalizes persisted widths to stable hard limits', () => {
    expect(readStoredDesktopPanelWidth(null)).toBe(DEFAULT_DESKTOP_PANEL_WIDTH)
    expect(readStoredDesktopPanelWidth('invalid')).toBe(DEFAULT_DESKTOP_PANEL_WIDTH)
    expect(readStoredDesktopPanelWidth('200')).toBe(280)
    expect(readStoredDesktopPanelWidth('720')).toBe(720)
    expect(readStoredDesktopPanelWidth('1200')).toBe(960)
  })

  it('reports the effective width and maximum for the current parent layout', () => {
    expect(maximumDesktopPanelWidth(763)).toBe(431)
    expect(effectiveDesktopPanelWidth(960, 763)).toBe(431)
    expect(effectiveDesktopPanelWidth(480, 1440)).toBe(480)
  })
})
