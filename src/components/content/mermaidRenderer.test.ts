import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mermaid.render.mockResolvedValue({ svg: '<svg viewBox="0 0 100 100" />' })
})
afterEach(() => vi.unstubAllGlobals())

function mockDocument() {
  const containers: Array<{ style: { cssText: string }; remove: ReturnType<typeof vi.fn> }> = []
  const appendChild = vi.fn()
  vi.stubGlobal('document', {
    createElement: () => {
      const container = { style: { cssText: '' }, remove: vi.fn() }
      containers.push(container)
      return container
    },
    body: { appendChild },
  })
  return { containers, appendChild }
}

describe('shared Mermaid rendering', () => {
  it('serializes themes across chats, assigns unique ids, and removes temporary DOM', async () => {
    const { containers } = mockDocument()
    const { renderMermaid } = await import('./mermaidRenderer')
    let release!: () => void
    let started!: () => void
    const rendering = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    mermaid.render.mockImplementationOnce(async () => {
      started()
      await gate
      return { svg: '<svg />' }
    })

    const light = renderMermaid('flowchart TD; A-->B', false, () => true)
    const dark = renderMermaid('sequenceDiagram\nA->>B: Hi', true, () => true)
    await rendering
    expect(mermaid.initialize).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([light, dark])

    expect(mermaid.initialize.mock.calls.map(([config]) => config.theme)).toEqual(['default', 'dark'])
    expect(mermaid.initialize.mock.calls[0][0]).toMatchObject({ securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true })
    expect(mermaid.render.mock.calls[0][0]).not.toBe(mermaid.render.mock.calls[1][0])
    expect(containers).toHaveLength(2)
    containers.forEach((container) => expect(container.remove).toHaveBeenCalledOnce())
  })

  it('skips queued diagrams that have already changed or unmounted', async () => {
    const { appendChild } = mockDocument()
    const { renderMermaid } = await import('./mermaidRenderer')
    await expect(renderMermaid('stale diagram', false, () => false)).resolves.toBeUndefined()
    expect(mermaid.initialize).not.toHaveBeenCalled()
    expect(mermaid.render).not.toHaveBeenCalled()
    expect(appendChild).not.toHaveBeenCalled()
  })

  it('cleans up failures and continues rendering later diagrams', async () => {
    const { containers } = mockDocument()
    const { renderMermaid } = await import('./mermaidRenderer')
    mermaid.render.mockRejectedValueOnce(new Error('Syntax error'))
    const failed = renderMermaid('invalid', false, () => true)
    const valid = renderMermaid('flowchart LR; A-->B', true, () => true)
    await expect(failed).rejects.toThrow('Syntax error')
    await expect(valid).resolves.toContain('<svg')
    containers.forEach((container) => expect(container.remove).toHaveBeenCalledOnce())
  })

  it('discards a completed render when its source changed during drawing', async () => {
    const { containers } = mockDocument()
    const { renderMermaid } = await import('./mermaidRenderer')
    let current = true
    mermaid.render.mockImplementationOnce(async () => {
      current = false
      return { svg: '<svg />' }
    })
    await expect(renderMermaid('old source', false, () => current)).resolves.toBeUndefined()
    expect(containers[0].remove).toHaveBeenCalledOnce()
  })
})
