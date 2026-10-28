import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it, vi } from 'vitest'
import { BoundedRenderCache } from './boundedRenderCache'
import type { MessageBlock } from './messageBlockTypes'

const script = parse(readFileSync(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
const ast = ts.createSourceFile('conversation.ts', script, ts.ScriptTarget.Latest, true)
const names = ['getMarkdownBlocks', 'setBoundedCacheEntry']
const code = ts.transpileModule(ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''),
).map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function setup() {
  const state = {
    props: { cwd: '/project-a' },
    markdownBlockCache: new BoundedRenderCache<string, MessageBlock[]>(),
    hasStreamingMarkdown: { value: false },
    MARKDOWN_BLOCK_CACHE_LIMIT: 300,
    parseMessageBlocks: vi.fn((text: string): MessageBlock[] => [{ kind: 'codeBlock', language: 'mermaid', value: text }]),
  }
  const context = createContext(state)
  runInContext(code, context)
  const getBlocks = runInContext('getMarkdownBlocks', context) as (text: string) => MessageBlock[]
  return { state, getBlocks }
}

describe('Plan Markdown block caching', () => {
  it('reuses the same parsed blocks when completed Plan content is unchanged', () => {
    const { state, getBlocks } = setup()
    const blocks = getBlocks('flowchart LR; A-->B')
    expect(getBlocks('flowchart LR; A-->B')).toBe(blocks)
    expect(state.parseMessageBlocks).toHaveBeenCalledOnce()
  })

  it('does not reuse blocks resolved for a different project', () => {
    const { state, getBlocks } = setup()
    const blocks = getBlocks('![Diagram](./diagram.png)')
    state.props.cwd = '/project-b'
    expect(getBlocks('![Diagram](./diagram.png)')).not.toBe(blocks)
    expect(state.parseMessageBlocks).toHaveBeenCalledTimes(2)
  })

  it('does not retain intermediate streaming Plan blocks', () => {
    const { state, getBlocks } = setup()
    state.hasStreamingMarkdown.value = true
    getBlocks('flowchart LR; A--')
    expect(state.markdownBlockCache.size).toBe(0)
    state.hasStreamingMarkdown.value = false
    const completed = getBlocks('flowchart LR; A-->B')
    expect(state.markdownBlockCache.size).toBe(1)
    expect(getBlocks('flowchart LR; A-->B')).toBe(completed)
  })
})
