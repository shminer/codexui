import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppServerProcess } from './codexAppServerBridge'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: spawnMock,
}))

type ProcessInternals = {
  lifecycleEpoch: number
  initialized: boolean
  initializePromise: Promise<void> | null
  memoryMaintenanceTimer: ReturnType<typeof setInterval> | null
  threadTurnPageReadCacheByThreadId: Map<string, unknown>
  threadTurnPageReadPromiseByThreadId: Map<string, Promise<unknown>>
  pendingTurnStarts: Map<string, Set<Promise<unknown>>>
  start(): void
  getCodexCommand(): { command: string }
  buildAppServerConfig(): { args: string[]; env: Record<string, string> }
  ensureInitialized(): Promise<void>
  call(method: string, params: unknown): Promise<unknown>
  sendLine(payload: Record<string, unknown>): void
}

const servers: AppServerProcess[] = []
const lifecycleError = 'codex app-server lifecycle changed'

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockProcess() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: true,
    kill: vi.fn(),
  })
}

function createServer() {
  const server = new AppServerProcess()
  servers.push(server)
  const internals = server as unknown as ProcessInternals
  vi.spyOn(internals, 'getCodexCommand').mockReturnValue({ command: process.execPath })
  const config = vi.spyOn(internals, 'buildAppServerConfig').mockReturnValue({ args: [], env: {} })
  spawnMock.mockImplementation(mockProcess)
  return { server, internals, config }
}

function readyServer() {
  const fixture = createServer()
  vi.spyOn(fixture.internals, 'ensureInitialized').mockResolvedValue(undefined)
  return { ...fixture, call: vi.spyOn(fixture.internals, 'call') }
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

afterEach(() => {
  servers.splice(0).forEach((server) => server.dispose())
  vi.restoreAllMocks()
  spawnMock.mockReset()
})

describe('app-server lifecycle cancellation', () => {
  it('releases only the deleted thread caches after a confirmed native deletion', async () => {
    const { server, call } = readyServer()
    const snapshot = { thread: { id: 'archived', path: '/archive/session.jsonl', turns: [] } }
    server.storeThreadReadSnapshot('archived', snapshot)
    server.cacheLiveState('archived', { saved: true }, 0, 100)
    server.storeThreadReadSnapshot('other', { thread: { id: 'other', turns: [] } })
    const readScope = server.beginThreadRead('archived')
    call.mockResolvedValueOnce({})
    expect(await server.rpc('thread/delete', { threadId: 'archived' })).toEqual({})
    expect(readScope.deleted).toBe(true)
    expect(server.getLastThreadReadSnapshot('archived')).toBeNull()
    expect(server.getCachedLiveState('archived', 0, 100)).toBeNull()
    server.rememberThreadPaths({ data: [{ id: 'archived', path: '/archive/stale.jsonl' }] })
    expect(server.getThreadSessionPath('archived')).toBeUndefined()
    expect(server.getLastThreadReadSnapshot('other')).not.toBeNull()
    expect(() => server.storeThreadReadSnapshot('archived', snapshot)).toThrow('deleted')
    readScope.release()
    expect((server as any).threadReadScopes.size).toBe(0)
  })

  it('preserves snapshots and reading scopes when native deletion fails', async () => {
    const { server, call } = readyServer()
    const snapshot = { thread: { id: 'archived', turns: [] } }
    server.storeThreadReadSnapshot('archived', snapshot)
    const readScope = server.beginThreadRead('archived')
    call.mockRejectedValueOnce(new Error('Delete failed'))
    await expect(server.rpc('thread/delete', { threadId: 'archived' })).rejects.toThrow('Delete failed')
    expect(server.getLastThreadReadSnapshot('archived')).toEqual(snapshot)
    expect(readScope.deleted).toBe(false)
    readScope.release()
  })

  it.each([false, true])('rejects a late page read without refetching after deletion (requestFails=%s)', async (requestFails) => {
    const { server, internals, call } = readyServer()
    const deferredRead = deferred()
    call.mockReturnValueOnce(deferredRead.promise).mockResolvedValueOnce({})
    const read = server.readThreadForTurnPage('archived')
    const rejected = expect(read).rejects.toThrow('deleted')
    await Promise.resolve()
    await server.rpc('thread/delete', { threadId: 'archived' })
    if (requestFails) deferredRead.reject(new Error('Late read failed'))
    else deferredRead.resolve({ thread: { id: 'archived', path: '/archive/session.jsonl', turns: [] } })
    await rejected
    expect(call.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/delete'])
    expect(internals.threadTurnPageReadCacheByThreadId.size).toBe(0)
    expect(internals.threadTurnPageReadPromiseByThreadId.size).toBe(0)
    expect(server.getThreadSessionPath('archived')).toBeUndefined()
    expect((server as any).threadReadScopes.size).toBe(0)
  })

  it('clears captured output and diagnostics on a native deletion notification', () => {
    const { server } = readyServer()
    ;(server as any).emitNotification({ method: 'item/completed', params: {
      threadId: 'archived', turnId: 'turn', item: {
        id: 'command', type: 'commandExecution', command: 'echo saved', status: 'completed', aggregatedOutput: 'saved output',
      },
    } })
    expect(server.getCapturedCommandOutput('archived', 'turn', 'command')).toBe('saved output')
    ;(server as any).emitNotification({ method: 'thread/deleted', params: { threadId: 'archived' } })
    expect(server.getCapturedCommandOutput('archived', 'turn', 'command')).toBeNull()
    expect(server.getStreamEvents('archived', 10).map((event) => event.method)).toEqual(['thread/deleted'])
  })

  it.each([false, true])('does not restart a disposed page read (requestFails=%s)', async (requestFails) => {
    const { server, internals, call } = readyServer()
    const request = deferred()
    call.mockReturnValue(request.promise)
    const start = vi.spyOn(internals, 'start')
    const read = server.readThreadForTurnPage('thread')
    const rejected = expect(read).rejects.toThrow(lifecycleError)
    await Promise.resolve()
    server.dispose()

    if (requestFails) request.reject(new Error('old request failed'))
    else request.resolve({ thread: { turns: [] } })

    await rejected
    expect(call).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    expect(internals.threadTurnPageReadCacheByThreadId.size).toBe(0)
    expect(internals.threadTurnPageReadPromiseByThreadId.size).toBe(0)
    expect(internals.memoryMaintenanceTimer).toBeNull()
  })

  it.each([false, true])('keeps a new page read separate from disposed work (requestFails=%s)', async (requestFails) => {
    const { server, internals, call } = readyServer()
    const oldRequest = deferred()
    const newRequest = deferred()
    call.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const oldRead = server.readThreadForTurnPage('thread')
    const oldRejected = expect(oldRead).rejects.toThrow(lifecycleError)
    await Promise.resolve()
    server.dispose()
    const newRead = server.readThreadForTurnPage('thread')
    await Promise.resolve()
    const pending = internals.threadTurnPageReadPromiseByThreadId.get('thread')

    if (requestFails) oldRequest.reject(new Error('old request failed'))
    else oldRequest.resolve({ thread: { turns: [{ id: 'old' }] } })

    await oldRejected
    expect(internals.threadTurnPageReadPromiseByThreadId.get('thread')).toBe(pending)
    expect(internals.threadTurnPageReadCacheByThreadId.size).toBe(0)
    expect(internals.memoryMaintenanceTimer).toBeNull()
    const retained = { thread: { turns: [{ id: 'new' }] } }
    newRequest.resolve(retained)
    expect(await newRead).toEqual(retained)
    expect(await server.readThreadForTurnPage('thread')).toEqual(retained)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('stops an RPC that was waiting for initialization when disposed', async () => {
    const { server, internals } = createServer()
    const initialization = deferred<void>()
    vi.spyOn(internals, 'ensureInitialized').mockReturnValue(initialization.promise)
    const call = vi.spyOn(internals, 'call')
    const request = server.rpc('thread/read', { threadId: 'thread' })
    const rejected = expect(request).rejects.toThrow(lifecycleError)
    server.dispose()
    initialization.resolve(undefined)

    await rejected
    expect(call).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it.each([false, true])('cancels initialization before its continuation runs (resolvedBeforeDispose=%s)', async (resolvedBeforeDispose) => {
    const { server, internals } = createServer()
    const initialization = deferred()
    const call = vi.spyOn(internals, 'call').mockReturnValueOnce(initialization.promise)
    const send = vi.spyOn(internals, 'sendLine').mockImplementation(() => {})
    const request = server.rpc('thread/read', { threadId: 'thread' })
    const rejected = expect(request).rejects.toThrow(lifecycleError)
    if (resolvedBeforeDispose) initialization.resolve({})
    server.dispose()
    expect(internals.initializePromise).toBeNull()
    if (!resolvedBeforeDispose) initialization.resolve({})

    await rejected
    expect(send).not.toHaveBeenCalled()
    expect(internals.initialized).toBe(false)
    expect(call.mock.calls.map(([method]) => method)).toEqual(['initialize'])
    expect(spawnMock).not.toHaveBeenCalled()

    const retained = { thread: { turns: [] } }
    call.mockResolvedValueOnce({}).mockResolvedValueOnce(retained)
    expect(await server.rpc('thread/read', { threadId: 'thread' })).toEqual(retained)
    expect(send).toHaveBeenCalledExactlyOnceWith({ jsonrpc: '2.0', method: 'initialized' })
    expect(internals.initialized).toBe(true)
  })

  it('does not let an old initialization finally clear its replacement', async () => {
    const { server, internals } = createServer()
    const oldInitialization = deferred()
    const newInitialization = deferred()
    const retained = { thread: { turns: [] } }
    const call = vi.spyOn(internals, 'call')
      .mockReturnValueOnce(oldInitialization.promise)
      .mockReturnValueOnce(newInitialization.promise)
      .mockResolvedValueOnce(retained)
    const send = vi.spyOn(internals, 'sendLine').mockImplementation(() => {})
    const oldRequest = server.rpc('thread/read', { threadId: 'thread' })
    const oldRejected = expect(oldRequest).rejects.toThrow(lifecycleError)
    server.dispose()
    const newRequest = server.rpc('thread/read', { threadId: 'thread' })
    const pending = internals.initializePromise
    expect(pending).not.toBeNull()
    oldInitialization.resolve({})

    await oldRejected
    expect(internals.initializePromise).toBe(pending)
    expect(send).not.toHaveBeenCalled()
    newInitialization.resolve({})
    expect(await newRequest).toEqual(retained)
    expect(internals.initializePromise).toBeNull()
    expect(call.mock.calls.map(([method]) => method)).toEqual(['initialize', 'initialize', 'thread/read'])
    expect(send).toHaveBeenCalledOnce()
  })

  it('accepts the new lifecycle created by its own configuration switch', async () => {
    const { server, internals, config } = createServer()
    internals.start()
    internals.initialized = true
    const first = spawnMock.mock.results[0]!.value as ReturnType<typeof mockProcess>
    const send = vi.spyOn(internals, 'sendLine')
    const oldRead = server.readThreadForTurnPage('old-thread')
    const oldRejected = expect(oldRead).rejects.toThrow(lifecycleError)
    await Promise.resolve()
    config.mockReturnValue({ args: ['--new-config'], env: {} })
    const newRead = server.readThreadForTurnPage('new-thread')
    const second = spawnMock.mock.results[1]!.value as ReturnType<typeof mockProcess>
    const initializationId = send.mock.calls.find(([payload]) => payload.method === 'initialize')![0].id
    second.stdout.write(`${JSON.stringify({ id: initializationId, result: {} })}\n`)
    await flushMicrotasks()
    const readPayload = send.mock.calls.find(([payload]) => payload.method === 'thread/read'
      && (payload.params as { threadId: string }).threadId === 'new-thread')![0]
    const retained = { thread: { id: 'new-thread', turns: [] } }
    second.stdout.write(`${JSON.stringify({ id: readPayload.id, result: retained })}\n`)

    await oldRejected
    expect(await newRead).toEqual(retained)
    expect(first.kill).toHaveBeenCalledWith('SIGTERM')
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(([payload]) => payload.method)).toEqual(['thread/read', 'initialize', 'initialized', 'thread/read'])
  })

  it('cancels the current process exit but ignores a previous process late exit', async () => {
    const { server, internals } = createServer()
    internals.start()
    internals.initialized = true
    const first = spawnMock.mock.results[0]!.value as ReturnType<typeof mockProcess>
    const send = vi.spyOn(internals, 'sendLine')
    const oldRead = server.readThreadForTurnPage('thread')
    const oldRejected = expect(oldRead).rejects.toThrow(lifecycleError)
    await Promise.resolve()
    first.emit('exit', 1)
    await oldRejected
    expect(spawnMock).toHaveBeenCalledOnce()
    vi.spyOn(internals, 'ensureInitialized').mockResolvedValue(undefined)
    const newRead = server.readThreadForTurnPage('thread')
    await Promise.resolve()
    const second = spawnMock.mock.results[1]!.value as ReturnType<typeof mockProcess>
    const epoch = internals.lifecycleEpoch
    first.emit('exit', 0)
    expect(internals.lifecycleEpoch).toBe(epoch)
    const payload = send.mock.calls.at(-1)![0]
    const retained = { thread: { turns: [] } }
    second.stdout.write(`${JSON.stringify({ id: payload.id, result: retained })}\n`)

    expect(await newRead).toEqual(retained)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('does not invalidate new thread caches after a disposed revert completes', async () => {
    const { server, internals, call } = readyServer()
    const revert = deferred()
    const page = deferred()
    call.mockReturnValueOnce(revert.promise).mockReturnValueOnce(page.promise)
    const request = server.rpc('thread/revert', { threadId: 'thread' })
    const rejected = expect(request).rejects.toThrow(lifecycleError)
    await Promise.resolve()
    server.dispose()
    const retained = { thread: { turns: [{ id: 'new' }] } }
    server.storeThreadReadSnapshot('thread', retained)
    server.cacheLiveState('thread', retained, 1, 100)
    const newRead = server.readThreadForTurnPage('thread')
    await Promise.resolve()
    const pending = internals.threadTurnPageReadPromiseByThreadId.get('thread')
    revert.resolve({})

    await rejected
    expect(server.getLastThreadReadSnapshot('thread')).toEqual(retained)
    expect(server.getCachedLiveState('thread', 1, 100)).toEqual(retained)
    expect(internals.threadTurnPageReadPromiseByThreadId.get('thread')).toBe(pending)
    page.resolve(retained)
    expect(await newRead).toEqual(retained)
  })

  it('does not remove a new pending turn start when the old one completes', async () => {
    const { server, internals, call } = readyServer()
    internals.start()
    const oldStart = deferred()
    const newStart = deferred()
    call.mockReturnValueOnce(oldStart.promise).mockReturnValueOnce(newStart.promise)
    const oldRequest = server.rpc('turn/start', { threadId: 'thread' })
    const oldRejected = expect(oldRequest).rejects.toThrow(lifecycleError)
    await Promise.resolve()
    server.dispose()
    const newRequest = server.rpc('turn/start', { threadId: 'thread' })
    await Promise.resolve()
    const pending = internals.pendingTurnStarts.get('thread')
    oldStart.resolve({ turn: { id: 'old' } })

    await oldRejected
    expect(internals.pendingTurnStarts.get('thread')).toBe(pending)
    expect(pending?.size).toBe(1)
    const result = { turn: { id: 'new' } }
    newStart.resolve(result)
    expect(await newRequest).toEqual(result)
    expect(internals.pendingTurnStarts.has('thread')).toBe(false)
  })
})
