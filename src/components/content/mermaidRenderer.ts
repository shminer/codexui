let mermaidLoader: Promise<typeof import('mermaid')> | undefined
let renderQueue: Promise<void> = Promise.resolve()
let nextDiagramId = 0

export function renderMermaid(source: string, dark: boolean, isCurrent: () => boolean): Promise<string | undefined> {
  const result = renderQueue.then(async () => {
    if (!isCurrent()) return
    const { default: mermaid } = await (mermaidLoader ??= import('mermaid').catch((error) => {
      mermaidLoader = undefined
      throw error
    }))
    if (!isCurrent()) return

    // Mermaid configuration is global; serialize initialization and rendering across all chat surfaces.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: dark ? 'dark' : 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    })
    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none'
    document.body.appendChild(container)
    try {
      const { svg } = await mermaid.render(`chat-mermaid-${++nextDiagramId}`, source, container)
      return isCurrent() ? svg : undefined
    } finally {
      container.remove()
    }
  })
  renderQueue = result.then(() => {}, () => {})
  return result
}
