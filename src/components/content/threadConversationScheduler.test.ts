import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

const script = parse(readFileSync(new URL('./ThreadConversation.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
const ast = ts.createSourceFile('conversation.ts', script, ts.ScriptTarget.Latest, true)
const names = ['getScrollWindow', 'cancelConversationScroll', 'scheduleConversationScroll', 'scheduleBottomLock', 'runBottomLockFrame']
const code = ts.transpileModule(ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''),
).map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function setup() {
  const frames = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  let id = 0
  const popup = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id },
    cancelAnimationFrame: (frame: number) => { cancelled.push(frame); frames.delete(frame) },
  }
  let applied = 0
  const state = {
    props: { ownerDocument: { defaultView: popup } },
    conversationListRef: { value: null },
    window: { requestAnimationFrame: () => { throw Error('parent window must not schedule popup scrolling') } },
    conversationScrollFrame: 0, bottomLockFrame: 0, bottomLockFramesLeft: 0,
    conversationScrollPromise: null, resolveConversationScroll: null, scrollWindow: null,
    scrollGeneration: 0, disposed: false,
    nextTick: () => Promise.resolve(),
    applyConversationScrollState: () => { applied++ },
    bindPendingImageHandlers: () => {},
    shouldLockToBottom: () => true,
    enforceBottomState: () => { applied++ },
  }
  const context = createContext(state)
  runInContext(code, context)
  const handlers = runInContext(`({ ${names.join(', ')} })`, context) as {
    scheduleConversationScroll: () => Promise<void>
    cancelConversationScroll: () => void
    scheduleBottomLock: (frames?: number) => void
  }
  function flushFrame() {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  }
  return { state, handlers, frames, cancelled, flushFrame, applied: () => applied }
}

describe('conversation scroll window lifecycle', () => {
  it('coalesces popup scrolling and uses its window for all bottom-lock frames', async () => {
    const test = setup()
    const first = test.handlers.scheduleConversationScroll()
    const second = test.handlers.scheduleConversationScroll()
    await Promise.resolve()
    expect(test.frames.size).toBe(1)
    test.flushFrame()
    await Promise.all([first, second])
    for (let frame = 0; frame < 6; frame++) test.flushFrame()
    expect(test.applied()).toBe(7)
    expect(test.frames.size).toBe(0)
  })

  it.each([false, true])('settles pending scrolling on owner change (RAF scheduled: %s)', async scheduled => {
    const test = setup()
    const pending = test.handlers.scheduleConversationScroll()
    if (scheduled) await Promise.resolve()
    test.handlers.cancelConversationScroll()
    await pending
    await Promise.resolve()
    expect(test.frames.size).toBe(0)
    expect(test.applied()).toBe(0)
    expect(test.cancelled.length).toBe(scheduled ? 1 : 0)
    // Cancellation must not leave the old coalesced promise blocking a new owner.
    const next = test.handlers.scheduleConversationScroll()
    await Promise.resolve()
    expect(test.frames.size).toBe(1)
    test.flushFrame()
    await next
    test.handlers.cancelConversationScroll()
    expect(test.frames.size).toBe(0)
  })

  it('does not schedule work after unmount', async () => {
    const test = setup()
    const pending = test.handlers.scheduleConversationScroll()
    test.state.disposed = true
    test.handlers.cancelConversationScroll()
    await pending
    await test.handlers.scheduleConversationScroll()
    test.handlers.scheduleBottomLock()
    expect(test.frames.size).toBe(0)
  })
})
