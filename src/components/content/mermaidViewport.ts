export type MermaidViewport = { zoom: number; x: number; y: number }

export const MIN_MERMAID_ZOOM = 0.25
export const MAX_MERMAID_ZOOM = 8

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
