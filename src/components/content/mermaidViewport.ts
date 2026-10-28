export type MermaidViewport = { zoom: number; x: number; y: number }

export const MIN_MERMAID_ZOOM = 0.25
export const MAX_MERMAID_ZOOM = 8

export function prepareMermaidSvg(svg: SVGSVGElement): { width: number; height: number } {
  const hasViewBox = svg.hasAttribute('viewBox')
  const bounds = hasViewBox ? svg.viewBox.baseVal : svg.getBBox()
  const padding = hasViewBox ? 0 : 8
  const width = bounds.width + padding * 2
  const height = bounds.height + padding * 2
  if (![bounds.x, bounds.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Invalid diagram dimensions')
  }
  if (!hasViewBox) {
    svg.setAttribute('viewBox', `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`)
  }
  return { width, height }
}

export function isMermaidLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'mermaid'
}

export function zoomMermaidViewport(view: MermaidViewport, zoom: number, anchorX = 0, anchorY = 0): MermaidViewport {
  const nextZoom = Math.min(MAX_MERMAID_ZOOM, Math.max(MIN_MERMAID_ZOOM, zoom))
  const ratio = nextZoom / view.zoom
  return {
    zoom: nextZoom,
    x: anchorX - (anchorX - view.x) * ratio,
    y: anchorY - (anchorY - view.y) * ratio,
  }
}

export function mermaidWheelZoom(zoom: number, delta: number, deltaMode: number): number {
  const pixels = delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1)
  return zoom * Math.exp(-Math.max(-200, Math.min(200, pixels)) * 0.005)
}
