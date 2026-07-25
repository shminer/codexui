import { describe, expect, it } from 'vitest'
import { clampTerminalWindowRect, initialTerminalWindowRect } from './terminalFloatingWindow'

describe('terminal floating window geometry', () => {
  it('clamps a window inside an offset visual viewport', () => {
    expect(clampTerminalWindowRect(
      { left: 0, top: 0, width: 800, height: 500 },
      { width: 320, height: 200, offsetLeft: 40, offsetTop: 120 },
    )).toEqual({ left: 48, top: 128, width: 304, height: 184 })
  })

  it('keeps a dragged window inside the far edge of an offset viewport', () => {
    expect(clampTerminalWindowRect(
      { left: 999, top: 999, width: 300, height: 260 },
      { width: 640, height: 480, offsetLeft: 16, offsetTop: 32 },
    )).toEqual({ left: 348, top: 244, width: 300, height: 260 })
  })

  it('starts below the visual viewport offset', () => {
    expect(initialTerminalWindowRect({ width: 390, height: 844, offsetLeft: 0, offsetTop: 50 }))
      .toEqual({ left: 8, top: 58, width: 374, height: 640 })
  })
})
