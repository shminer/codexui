import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it, vi } from 'vitest'

const script = parse(readFileSync(new URL('./ConversationVirtualRow.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
const ast = ts.createSourceFile('ConversationVirtualRow.ts', script, ts.ScriptTarget.Latest, true)
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function setup() {
  const props = { item: { id: 'first' }, index: 1, active: true }
  const measure = vi.fn(), emit = vi.fn()
  let readOptions!: () => { item: { id: string }; active: boolean; index: number; onResize: () => void }
  let afterPatch!: () => void
  runInContext(code, createContext({
    defineProps: () => props,
    defineEmits: () => emit,
    ref: () => ({ value: undefined }),
    useDynamicScrollerItem: (read: typeof readOptions) => {
      readOptions = read
      return { updateSize: measure }
    },
    onUpdated: (callback: () => void) => { afterPatch = callback },
  }))
  return { props, measure, emit, options: () => readOptions(), patch: () => afterPatch() }
}

describe('conversation virtual row measurement', () => {
  it('remeasures the patched slot without replacing the row controller', () => {
    const { props, measure, options, patch } = setup()
    patch()
    expect(measure).toHaveBeenCalledTimes(1)
    props.item = { id: 'reused' }
    props.index = 4
    patch()
    expect(options().item.id).toBe('reused')
    expect(options().index).toBe(4)
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('rechecks actual geometry after a deferred size report before notifying the list', () => {
    const { measure, emit, options } = setup()
    options().onResize()
    expect(measure).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith('resize')
    expect(measure.mock.invocationCallOrder[0]).toBeLessThan(emit.mock.invocationCallOrder[0]!)
  })

  it('passes activation changes to the existing measurement controller', () => {
    const { props, options } = setup()
    props.active = false
    expect(options().active).toBe(false)
    props.active = true
    expect(options().active).toBe(true)
  })
})
