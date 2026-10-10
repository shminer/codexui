import { readFile } from 'node:fs/promises'
import { ScriptTarget, transpileModule } from 'typescript'
import { describe, expect, it, vi } from 'vitest'

async function readInitialize(): Promise<string> {
  const source = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
  return source.match(/async function initialize\(\): Promise<void> \{([\s\S]*?)\n\}\n/u)?.[0] ?? ''
}

async function runInitialize(dependencies: Record<string, unknown>): Promise<void> {
  const source = await readInitialize()
  expect(source).not.toBe('')
  const { outputText } = transpileModule(source, { compilerOptions: { target: ScriptTarget.ESNext } })
  return new Function(...Object.keys(dependencies), `${outputText}; return initialize()`)(...Object.values(dependencies))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('app startup ownership', () => {
  it('starts direct-thread hydration alongside account, provider and list requests', async () => {
    const source = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
    const initialize = source.match(/async function initialize\(\): Promise<void> \{([\s\S]*?)\n\}\n/u)?.[1] ?? ''
    expect(initialize).toContain('const accountsReady = loadAccountsState')
    expect(initialize).toContain('loadFreeModeStatus({ deferRefresh: true })')
    expect(initialize).toContain('includeAncillaryRefreshes: false')
    expect(initialize).toContain('ensureThreadMessagesLoaded(initialThreadId)')
    expect(initialize).toContain('Promise.all([accountsReady, providerReady, threadsReady])')
    expect(initialize).not.toContain('await ensureThreadMessagesLoaded')
    expect(initialize).not.toContain('selectThread(')
    expect(initialize.match(/refreshAncillaryState\(/gu)).toHaveLength(1)
    expect(initialize.indexOf('hasInitialized.value = true')).toBeLessThan(initialize.indexOf('await refreshAncillaryState'))
    expect(initialize).toContain("primeSelectedThread(currentThreadId, { persist: Boolean(currentThreadId) })")
  })

  it('gives startup one provider/auth refresh owner and releases the gate on failure', async () => {
    const source = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
    expect(source).not.toContain('void loadFreeModeStatus()')
    expect(source).toContain('if (options.deferRefresh) return providerChanged')
    expect(source).toContain('if (isStartupAuthRefreshPending || isAppDisposed) return')
    expect(source).toMatch(/finally\s*\{\s*isStartupAuthRefreshPending = false/u)
    expect(source).toContain('routeThreadId.value === initialThreadId && selectedThreadId.value === initialThreadId')
    expect(source).toContain('if (await maybeImportExternalCodexAuthAccount())')
  })

  it('opens the current route without waiting for the previous route body', async () => {
    const bodyA = deferred<void>()
    const threads = deferred<void>()
    const route = { name: 'thread' }
    const routeThreadId = { value: 'A' }
    const selectedThreadId = { value: '' }
    const hasInitialized = { value: false }
    const ensureThreadMessagesLoaded = vi.fn((id: string) => id === 'A' ? bodyA.promise : Promise.resolve())
    const refreshAncillaryState = vi.fn(async () => {})
    const startup = runInitialize({
      router: { isReady: async () => {} }, route, routeThreadId, selectedThreadId, hasInitialized,
      isAppDisposed: false, isStartupAuthRefreshPending: true,
      primeSelectedThread: (id: string) => { selectedThreadId.value = id },
      loadAccountsState: async () => {}, loadFreeModeStatus: async () => false,
      refreshAll: () => threads.promise, ensureThreadMessagesLoaded,
      applyLaunchProjectPathFromUrl: async () => {},
      syncThreadSelectionWithRoute: vi.fn(), startPolling: vi.fn(), refreshAncillaryState,
      maybeImportExternalCodexAuthAccount: async () => false,
    })
    await vi.waitFor(() => expect(ensureThreadMessagesLoaded).toHaveBeenCalledWith('A'))
    routeThreadId.value = 'B'
    threads.resolve()
    try {
      await vi.waitFor(() => {
        expect(selectedThreadId.value).toBe('B')
        expect(hasInitialized.value).toBe(true)
        expect(ensureThreadMessagesLoaded).toHaveBeenCalledWith('B')
        expect(refreshAncillaryState).toHaveBeenCalledTimes(1)
      })
    } finally {
      bodyA.resolve()
      await startup
    }
  })

  it('does not subscribe to the temporary first thread when navigating from home during startup', async () => {
    const accounts = deferred<void>()
    const provider = deferred<boolean>()
    const route = { name: 'home' }
    const routeThreadId = { value: '' }
    const selectedThreadId = { value: '' }
    const startPolling = vi.fn()
    const ensureThreadMessagesLoaded = vi.fn(async () => {})
    const startup = runInitialize({
      router: { isReady: async () => {} }, route, routeThreadId, selectedThreadId,
      hasInitialized: { value: false }, isAppDisposed: false, isStartupAuthRefreshPending: true,
      primeSelectedThread: (id: string) => { selectedThreadId.value = id },
      loadAccountsState: () => accounts.promise, loadFreeModeStatus: () => provider.promise,
      refreshAll: async () => { selectedThreadId.value = 'A' }, ensureThreadMessagesLoaded,
      applyLaunchProjectPathFromUrl: async () => {}, syncThreadSelectionWithRoute: vi.fn(),
      startPolling, refreshAncillaryState: async () => {}, maybeImportExternalCodexAuthAccount: async () => false,
    })
    await vi.waitFor(() => expect(selectedThreadId.value).toBe('A'))
    route.name = 'thread'
    routeThreadId.value = 'B'
    accounts.resolve()
    try {
      await accounts.promise
      expect(startPolling).not.toHaveBeenCalled()
      expect(ensureThreadMessagesLoaded).not.toHaveBeenCalled()
    } finally {
      provider.resolve(false)
      await startup
    }
    expect(selectedThreadId.value).toBe('B')
    expect(ensureThreadMessagesLoaded).toHaveBeenCalledWith('B')
    expect(startPolling).toHaveBeenCalledTimes(1)
  })
})
