import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { historyScrollDirection } from './threadConversationWindow'

// Exercise the component's actual input/scroll handlers without a browser layout engine.
const filename = new URL('./ThreadConversation.vue', import.meta.url)
const script = parse(readFileSync(filename, 'utf8')).descriptor.scriptSetup!.content
const ast = ts.createSourceFile('ThreadConversation.ts', script, ts.ScriptTarget.Latest, true)
const handlerNames = ['isAtBottom', 'updateConversationBottom', 'shouldLockToBottom',
  'resumeFollowingAtBottom', 'stopFollowingForEarlierScroll', 'onConversationScroll',
  'onConversationWheel', 'onConversationTouchStart', 'onConversationTouchMove',
  'onConversationPointerDown', 'onConversationKeyDown', 'onConversationScrollEnd']
const declarations = ast.statements.filter(statement =>
  (ts.isFunctionDeclaration(statement) && handlerNames.includes(statement.name?.text ?? ''))
  || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
    declaration => declaration.name.getText(ast) === 'showJumpToLatestButton')),
)
const code = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function setup() {
  const container = {
    scrollTop: 300, scrollHeight: 1000, clientHeight: 300, clientWidth: 400, offsetWidth: 416,
    getBoundingClientRect: () => ({ right: 500 }),
  }
  const calls = { latestScroll: 0, older: 0, newer: 0 }
  const state = {
    props: {
      isLoading: false, isLoadingPersistedAbove: false, isLoadingPersistedBelow: false,
      isHistoryWindow: true, hasMorePersistedBelow: false,
      messages: [{ id: 'answer' }], pendingRequests: [], liveOverlay: null,
    },
    autoFollowOutput: { value: false }, conversationAtBottom: { value: false },
    conversationListRef: { value: container },
    isLoadingMore: { value: false }, isLoadingLatest: { value: false },
    hasMoreAbove: { value: true }, hasMoreBelow: { value: false },
    searchTargetId: { value: '' }, searchTurnMessages: { value: [] as unknown[] },
    resumeFollowOnBottom: false,
    paginationIntent: null as 'earlier' | 'later' | 'either' | null,
    lastConversationScrollTop: 300, conversationTouchY: 0,
    historyEdgeArmed: { earlier: true, later: true },
    BOTTOM_THRESHOLD_PX: 16, LOAD_MORE_SCROLL_THRESHOLD_PX: 200,
    historyScrollDirection,
    innerScrollConsumes: () => false,
    scheduleBottomLock: () => {},
    scheduleConversationScroll: () => { calls.latestScroll += 1 },
    loadMoreAbove: () => { calls.older += 1 },
    loadMoreBelow: () => { calls.newer += 1 },
    computed: (read: () => boolean) => ({ get value() { return read() } }),
  }
  const context = createContext(state)
  runInContext(code, context)
  const handlers = runInContext(`({ ${handlerNames.join(', ')}, showJumpToLatestButton })`, context) as {
    onConversationScroll: () => void
    onConversationScrollEnd: () => void
    onConversationWheel: (event: Partial<WheelEvent>) => void
    onConversationTouchStart: (event: { touches: { clientY: number }[] }) => void
    onConversationTouchMove: (event: { touches: { clientY: number }[] }) => void
    onConversationPointerDown: (event: Partial<PointerEvent>) => void
    onConversationKeyDown: (event: { key: string; target: { closest: () => null } }) => void
    showJumpToLatestButton: { value: boolean }
  }
  return { container, state, calls, handlers }
}

describe('conversation bottom following', () => {
  it('finishes a scrollbar drag after pagination has consumed its intent', () => {
    const { container, state, calls, handlers } = setup()
    handlers.onConversationPointerDown({ button: 0, target: container as unknown as EventTarget, clientX: 500 })
    container.scrollTop = 100
    handlers.onConversationScroll()
    expect(calls.older).toBe(1)
    expect(state.paginationIntent).toBeNull()
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(true)
    expect(handlers.showJumpToLatestButton.value).toBe(false)
    expect(calls.latestScroll).toBe(1)
  })

  it.each(['wheel', 'touch', 'End'] as const)('resumes after user scrolls to the bottom with %s', input => {
    const { container, state, handlers } = setup()
    if (input === 'wheel') handlers.onConversationWheel({ deltaY: 100 })
    else if (input === 'touch') {
      handlers.onConversationTouchStart({ touches: [{ clientY: 300 }] })
      handlers.onConversationTouchMove({ touches: [{ clientY: 100 }] })
    } else handlers.onConversationKeyDown({ key: 'End', target: { closest: () => null } })
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(true)
    expect(handlers.showJumpToLatestButton.value).toBe(false)
  })

  it('resumes on downward input even if the user is already at the physical bottom', () => {
    const { container, state, handlers } = setup()
    container.scrollTop = 700
    handlers.onConversationWheel({ deltaY: 100 })
    expect(state.autoFollowOutput.value).toBe(true)
    expect(handlers.showJumpToLatestButton.value).toBe(false)
  })

  it('keeps the arrow at a historical bottom with unread newer content', () => {
    const { container, state, handlers } = setup()
    state.hasMoreBelow.value = state.props.hasMorePersistedBelow = true
    handlers.onConversationWheel({ deltaY: 100 })
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(false)
    expect(handlers.showJumpToLatestButton.value).toBe(true)
  })

  it('lets a user leave search navigation by scrolling back to the latest bottom', () => {
    const { container, state, handlers } = setup()
    state.searchTargetId.value = 'search-hit'
    state.searchTurnMessages.value = [{ id: 'search-hit' }]
    handlers.onConversationWheel({ deltaY: 100 })
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.searchTargetId.value).toBe('')
    expect(state.searchTurnMessages.value).toEqual([])
    expect(state.autoFollowOutput.value).toBe(true)
  })

  it('does not treat programmatic anchoring as a user return to latest', () => {
    const { container, state, calls, handlers } = setup()
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(false)
    expect(handlers.showJumpToLatestButton.value).toBe(false)
    expect(calls.latestScroll).toBe(0)
    container.scrollTop = 300
    handlers.onConversationScroll()
    expect(handlers.showJumpToLatestButton.value).toBe(true)
  })

  it('keeps reading protection during a pending page request', () => {
    const { container, state, handlers } = setup()
    state.isLoadingMore.value = true
    handlers.onConversationWheel({ deltaY: 100 })
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(false)
    state.isLoadingMore.value = false
    // No extra movement is needed when the next downward input is already at bottom.
    handlers.onConversationWheel({ deltaY: 100 })
    expect(state.autoFollowOutput.value).toBe(true)
  })

  it('cancels a pending return to latest when the reader changes direction', () => {
    const { container, state, handlers } = setup()
    handlers.onConversationWheel({ deltaY: 100 })
    handlers.onConversationWheel({ deltaY: -100 })
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(false)
  })

  it('expires the user return intent before a later programmatic layout change', () => {
    const { container, state, handlers } = setup()
    handlers.onConversationWheel({ deltaY: 100 })
    container.scrollTop = 400
    handlers.onConversationScroll()
    handlers.onConversationScrollEnd()
    expect(state.resumeFollowOnBottom).toBe(false)
    container.scrollTop = 700
    handlers.onConversationScroll()
    expect(state.autoFollowOutput.value).toBe(false)
  })
})
