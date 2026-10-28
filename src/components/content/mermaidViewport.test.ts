import { describe, expect, it } from 'vitest'
import { isMermaidLanguage, mermaidWheelZoom, zoomMermaidViewport } from './mermaidViewport'

describe('Mermaid viewport', () => {
  it('recognizes Mermaid without capturing other fenced languages', () => {
    expect(isMermaidLanguage('  MeRmAiD  ')).toBe(true)
    expect(isMermaidLanguage('javascript')).toBe(false)
    expect(isMermaidLanguage('mermaid-example')).toBe(false)
    expect(isMermaidLanguage('')).toBe(false)
  })

  it('keeps the diagram point under the mouse stationary while zooming', () => {
    const before = { zoom: 1.5, x: 30, y: -20 }
    const anchor = { x: 140, y: 75 }
    const after = zoomMermaidViewport(before, 3, anchor.x, anchor.y)
    expect((anchor.x - after.x) / after.zoom).toBeCloseTo((anchor.x - before.x) / before.zoom)
    expect((anchor.y - after.y) / after.zoom).toBeCloseTo((anchor.y - before.y) / before.zoom)
  })

  it('clamps zoom and does not drift when already at either limit', () => {
    const minimum = { zoom: 0.25, x: 80, y: -30 }
    const maximum = { zoom: 8, x: -60, y: 90 }
    expect(zoomMermaidViewport(minimum, 0.01, 120, 80)).toEqual(minimum)
    expect(zoomMermaidViewport(maximum, 50, 120, 80)).toEqual(maximum)
  })

  it('round trips a zoom without changing the pan offset', () => {
    const initial = { zoom: 1, x: 40, y: 60 }
    const enlarged = zoomMermaidViewport(initial, 2, 100, 200)
    const restored = zoomMermaidViewport(enlarged, 1, 100, 200)
    expect(restored).toEqual(initial)
  })

  it('handles pixel, line and page wheel units with bounded jumps', () => {
    expect(mermaidWheelZoom(1, 16, 0)).toBeCloseTo(mermaidWheelZoom(1, 1, 1))
    expect(mermaidWheelZoom(1, -1, 0)).toBeGreaterThan(1)
    expect(mermaidWheelZoom(1, 1, 0)).toBeLessThan(1)
    expect(mermaidWheelZoom(1, 1, 2)).toBe(mermaidWheelZoom(1, 100000, 0))
    expect(mermaidWheelZoom(2, 0, 0)).toBe(2)
  })
})
