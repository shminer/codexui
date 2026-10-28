import { describe, expect, it, vi } from 'vitest'
import { isMermaidLanguage, mermaidWheelZoom, prepareMermaidSvg, zoomMermaidViewport } from './mermaidViewport'

describe('Mermaid SVG dimensions', () => {
  function mockSvg(viewBox: { x: number; y: number; width: number; height: number } | null) {
    return {
      hasAttribute: () => viewBox !== null,
      viewBox: { baseVal: viewBox },
      getBBox: vi.fn(() => ({ x: 50, y: 10, width: 100, height: 40 })),
      setAttribute: vi.fn(),
    }
  }

  it('keeps an existing viewBox without measuring or rewriting the diagram', () => {
    const svg = mockSvg({ x: -12, y: -4, width: 640, height: 480 })
    expect(prepareMermaidSvg(svg as unknown as SVGSVGElement)).toEqual({ width: 640, height: 480 })
    expect(svg.getBBox).not.toHaveBeenCalled()
    expect(svg.setAttribute).not.toHaveBeenCalled()
  })

  it('fits an info-style SVG without a viewBox around its content and padding', () => {
    const svg = mockSvg(null)
    expect(prepareMermaidSvg(svg as unknown as SVGSVGElement)).toEqual({ width: 116, height: 56 })
    expect(svg.setAttribute).toHaveBeenCalledWith('viewBox', '42 2 116 56')
  })

  it.each([0, -1, Infinity, NaN])('rejects invalid viewBox widths (%s)', (width) => {
    const svg = mockSvg({ x: 0, y: 0, width, height: 100 })
    expect(() => prepareMermaidSvg(svg as unknown as SVGSVGElement)).toThrow('Invalid diagram dimensions')
  })
})

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
