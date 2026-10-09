import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AppServerProcess, createCodexBridgeMiddleware } from './codexAppServerBridge'
import { PERMISSIVE_SECURITY_POLICY } from './securityPolicy'
import { EphemeralHistoryStore } from './ephemeralHistoryStore'

let server: Server | undefined
let bridge: ReturnType<typeof createCodexBridgeMiddleware> | undefined
let directory = ''
const processes: AppServerProcess[] = []
afterEach(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  bridge?.dispose()
  bridge = undefined
  for (const process of processes.splice(0)) process.dispose()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function start(allowRead: () => boolean = () => true, denyItemReads = false) {
  bridge = createCodexBridgeMiddleware({ securityPolicy: {
    ...PERMISSIVE_SECURITY_POLICY,
    backgroundIntegrationsEnabled: false,
    isRpcMethodAllowed: (method) => method === 'thread/items/list' && denyItemReads ? false : method !== 'thread/read' || allowRead(),
  } })
  server = createServer((req, res) => { void bridge!(req, res, () => res.end()) })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test listener')
  return `http://127.0.0.1:${address.port}`
}

it('reads ephemeral pages and full sources without calling native history RPC', async () => {
  const cache = new EphemeralHistoryStore()
  cache.register('side')
  cache.capture('turn/started', { threadId: 'side', turn: { id: 'turn' } })
  cache.capture('item/completed', { threadId: 'side', turnId: 'turn', item: { id: 'command', type: 'commandExecution', command: 'echo', status: 'completed', aggregatedOutput: 'x'.repeat(70000) } })
  cache.capture('turn/completed', { threadId: 'side', turn: { id: 'turn', status: 'completed' } })
  const page = cache.page('side', '', '', 20)
  const item = cache.item('side', 'turn', 'command')
  vi.spyOn(EphemeralHistoryStore.prototype, 'page').mockReturnValue(page)
  vi.spyOn(EphemeralHistoryStore.prototype, 'item').mockReturnValue(item)
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc')
  const base = await start()
  const response = await fetch(`${base}/codex-api/thread-turn-page?threadId=side&source=ephemeral`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ result: { thread: { id: 'side' } }, nextTurnIndex: 1 })
  const output = await fetch(`${base}/codex-api/thread-resource-source?threadId=side&turnId=turn&itemId=command&source=ephemeral&view=command-output&offset=0&limit=100`)
  expect(await output.json()).toEqual({ data: { text: 'x'.repeat(100), offset: 0, totalLength: 70000, nextOffset: 100 } })
  const full = await fetch(`${base}/codex-api/thread-resource-source?threadId=side&turnId=turn&itemId=command&source=ephemeral`)
  expect(await full.json()).toMatchObject({ data: [{ id: 'command', commandExecution: { aggregatedOutput: 'x'.repeat(70000) } }] })
  expect(rpc).not.toHaveBeenCalled()
})

it('keeps policy checks in front of ephemeral history routes', async () => {
  const page = vi.spyOn(EphemeralHistoryStore.prototype, 'page')
  const item = vi.spyOn(EphemeralHistoryStore.prototype, 'item')
  const base = await start(() => false, true)
  for (const route of ['thread-turn-page?threadId=side', 'thread-resource-source?threadId=side&turnId=turn&itemId=item']) {
    expect((await fetch(`${base}/codex-api/${route}&source=ephemeral`)).status).toBe(403)
  }
  expect(page).not.toHaveBeenCalled()
  expect(item).not.toHaveBeenCalled()
})

it('never copies expired or closed ephemeral events into the ordinary capture cache', async () => {
  const appServer = new AppServerProcess()
  processes.push(appServer)
  vi.spyOn(appServer as any, 'ensureInitialized').mockResolvedValue(undefined)
  vi.spyOn(appServer as any, 'call').mockResolvedValue({ thread: { id: 'side' } })
  await appServer.rpc('thread/fork', { threadId: 'parent', ephemeral: true })
  appServer.ephemeralHistory.remove('side')
  const event = { method: 'item/completed', params: { threadId: 'side', turnId: 'turn', item: { id: 'command', type: 'commandExecution', aggregatedOutput: 'output' } } }
  ;(appServer as any).emitNotification(event)
  expect((appServer as any).capturedItemsByThreadId.has('side')).toBe(false)
  ;(appServer as any).emitNotification({ method: 'turn/started', params: { threadId: 'side', turn: { id: 'turn' } } })
  ;(appServer as any).emitNotification(event)
  expect(appServer.ephemeralHistory.page('side', '', '', 20).historyTruncated).toBe(true)
  await appServer.rpc('thread/unsubscribe', { threadId: 'side' })
  ;(appServer as any).emitNotification(event)
  expect((appServer as any).capturedItemsByThreadId.has('side')).toBe(false)
  expect(appServer.ephemeralHistory.stats.threads).toBe(0)
  expect((appServer as any).ephemeralThreadIds.size).toBe(0)
})

it('bounds ephemeral lifecycle registrations before issuing additional forks', async () => {
  const appServer = new AppServerProcess()
  processes.push(appServer)
  vi.spyOn(appServer as any, 'ensureInitialized').mockResolvedValue(undefined)
  let nextId = 0
  const call = vi.spyOn(appServer as any, 'call').mockImplementation(async () => ({ thread: { id: `side-${nextId++}` } }))
  for (let index = 0; index < 8; index++) await appServer.rpc('thread/fork', { threadId: 'parent', ephemeral: true })
  await expect(appServer.rpc('thread/fork', { threadId: 'parent', ephemeral: true })).rejects.toThrow('Temporary conversation limit reached')
  expect(call).toHaveBeenCalledTimes(8)
})

it('uses exclusive before/after anchors, latest windows, and explicit stale-window errors', async () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index}`, items: [] }))
  vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ thread: { id: 'thread', turns } })
  const base = await start()
  const page = async (query: string) => (await fetch(`${base}/codex-api/thread-turn-page?threadId=thread&limit=2&${query}`)).json() as Promise<{ result: { thread: { turns: { id: string }[] } } }>
  const latest = await page('')
  expect(latest.result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual(['turn-4', 'turn-5'])
  expect(latest).toMatchObject({ startTurnIndex: 4, hasMoreOlder: true, hasMoreNewer: false, nextTurnIndex: 6 })
  const older = await page('beforeTurnId=turn-4')
  expect(older.result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual(['turn-2', 'turn-3'])
  expect(older).toMatchObject({ startTurnIndex: 2, hasMoreNewer: true, nextTurnIndex: 6 })
  const newer = await page('afterTurnId=turn-2')
  expect(newer.result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual(['turn-3', 'turn-4'])
  const stale = await fetch(`${base}/codex-api/thread-turn-page?threadId=thread&beforeTurnId=removed`)
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ code: 'stale_window' })
  expect((await fetch(`${base}/codex-api/thread-turn-page?threadId=thread&beforeTurnId=a&afterTurnId=b`)).status).toBe(400)
})

it.each(['/codex-api/thread-turn-page', '/codex-api/thread-live-state', '/codex-api/rpc'])('blocks stale history responses and cache writes after deletion (%s)', async (route) => {
  directory = await mkdtemp(join(tmpdir(), 'codex-deleted-history-'))
  vi.stubEnv('CODEX_HOME', directory)
  let started!: (process: AppServerProcess) => void
  const reading = new Promise<AppServerProcess>((resolve) => { started = resolve })
  let finish!: (result: unknown) => void
  const staleRead = new Promise<unknown>((resolve) => { finish = resolve })
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockImplementation(function (this: AppServerProcess) {
    started(this)
    return staleRead
  })
  const base = await start()
  const response = route === '/codex-api/rpc'
    ? fetch(`${base}${route}`, { method: 'POST', body: JSON.stringify({ method: 'thread/read', params: { threadId: 'deleted', includeTurns: true } }) })
    : fetch(`${base}${route}?threadId=deleted`)
  const process = await reading
  await process.forgetDeletedThread('deleted')
  finish({ thread: { id: 'deleted', turns: [{ id: 'old-turn', items: [] }] } })
  const result = await response
  expect(result.status).toBe(410)
  expect(await result.json()).toMatchObject({ code: 'thread_deleted' })
  expect(process.getLastThreadReadSnapshot('deleted')).toBeNull()
  expect(process.getThreadSessionPath('deleted')).toBeUndefined()
  expect((process as any).threadReadScopes.size).toBe(0)
  expect(rpc).toHaveBeenCalledOnce()
})

it('returns only a requested command output page and preserves the normal source response', async () => {
  const output = 'a'.repeat(70000)
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ data: [
    { turnId: 'turn', item: { id: 'command', type: 'commandExecution', command: 'echo', status: 'completed', aggregatedOutput: output } },
  ], nextCursor: null })
  const base = await start()
  const route = `${base}/codex-api/thread-resource-source?threadId=thread&turnId=turn&itemId=command`
  expect(await (await fetch(`${route}&view=command-output`)).json()).toEqual({ data: { text: 'a'.repeat(65536), offset: 4464, totalLength: 70000, nextOffset: null } })
  expect(await (await fetch(`${route}&view=command-output&offset=0&limit=100`)).json()).toEqual({ data: { text: 'a'.repeat(100), offset: 0, totalLength: 70000, nextOffset: 100 } })
  const original = await (await fetch(route)).json() as { data: { commandExecution: { aggregatedOutput: string } }[] }
  expect(original.data[0]?.commandExecution.aggregatedOutput).toBe(output)
  const calls = rpc.mock.calls.length
  expect((await fetch(`${route}&view=command-output&limit=65537`)).status).toBe(400)
  expect((await fetch(`${route}&view=command-output&offset=-1`)).status).toBe(400)
  expect(rpc).toHaveBeenCalledTimes(calls)
})

it('checks turn read policy before returning cached windows or issuing RPC requests', async () => {
  let allowed = false
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ thread: { id: 'policy-thread', turns: [] } })
  const base = await start(() => allowed)
  const route = `${base}/codex-api/thread-turn-page?threadId=policy-thread`
  expect((await fetch(route)).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()
  allowed = true
  expect((await fetch(route)).status).toBe(200)
  expect(rpc).toHaveBeenCalledOnce()
  allowed = false
  expect((await fetch(route)).status).toBe(403)
  expect(rpc).toHaveBeenCalledOnce()
})

it('updates cached session paths from a successful turn page read', async () => {
  const process = new AppServerProcess()
  processes.push(process)
  process.rememberThreadSessionPath('thread', '/old/session.jsonl')
  vi.spyOn(process, 'rpc').mockResolvedValue({ thread: { id: 'thread', path: '/new/session.jsonl', turns: [] } })
  await process.readThreadForTurnPage('thread')
  expect(process.getThreadSessionPath('thread')).toBe('/new/session.jsonl')
})

it('reschedules capture verification only when the saved path changes', () => {
  const process = new AppServerProcess()
  processes.push(process)
  process.rememberThreadSessionPath('thread', '/old/session.jsonl')
  ;(process as any).captureItemFromNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { id: 'command', type: 'commandExecution', command: 'echo', status: 'completed', aggregatedOutput: 'saved' } } })
  const queue = (process as any).captureVerificationByThreadId as Map<string, unknown>
  queue.clear()
  process.rememberThreadSessionPath('thread', '/old/session.jsonl')
  expect(queue.has('thread')).toBe(false)
  process.rememberThreadSessionPath('thread', '/new/session.jsonl')
  expect(queue.get('thread')).toMatchObject({ attempts: 0 })
})

it('releases a captured command only when saved content is fully equivalent', async () => {
  directory = await mkdtemp(join(tmpdir(), 'codexui-captured-'))
  const sessions = join(directory, 'sessions')
  await mkdir(sessions)
  vi.stubEnv('CODEX_HOME', directory)
  const path = join(sessions, 'thread.jsonl')
  const rows = [
    { type: 'session_meta', payload: { id: 'thread' } },
    { type: 'turn_context', payload: { turn_id: 'turn' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call', arguments: '{"cmd":"echo ok"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call', output: 'Output:\nok' } },
  ]
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n'))
  const process = new AppServerProcess()
  processes.push(process)
  process.rememberThreadSessionPath('thread', path)
  const completed = (itemId: string, output: string) => (process as any).captureItemFromNotification({
    method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { id: itemId, type: 'commandExecution', command: 'echo ok', status: 'completed', aggregatedOutput: output } },
  })
  completed('session-cmd-call', 'different content')
  ;(process as any).captureVerificationByThreadId.set('thread', { dueAt: 0, attempts: 0 })
  await (process as any).verifyNextPersistedCapture()
  expect(process.getCapturedCommandOutput('thread', 'turn', 'session-cmd-call')).toBe('different content')
  completed('session-cmd-call', 'ok')
  ;(process as any).captureVerificationByThreadId.set('thread', { dueAt: 0, attempts: 0 })
  await (process as any).verifyNextPersistedCapture()
  expect(process.getCapturedCommandOutput('thread', 'turn', 'session-cmd-call')).toBeNull()
  completed('live-only', 'only copy')
  ;(process as any).captureVerificationByThreadId.set('thread', { dueAt: 0, attempts: 0 })
  await (process as any).verifyNextPersistedCapture()
  process.dispose()
  expect(process.getCapturedCommandOutput('thread', 'turn', 'live-only')).toBe('only copy')
})

it('returns full captured commands through the same source route used by output pages', async () => {
  const item = { id: 'capture', type: 'commandExecution', command: 'echo captured', status: 'failed', exitCode: 1, cwd: '/project', aggregatedOutput: 'captured output' }
  vi.spyOn(AppServerProcess.prototype, 'getCapturedCommandItem').mockImplementation((_thread, _turn, itemId) => itemId === 'capture' ? item : null)
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc')
  const base = await start()
  const route = `${base}/codex-api/thread-resource-source?threadId=thread&turnId=turn&itemId=capture`
  const source = await (await fetch(route)).json() as { data: { id: string; turnId: string; commandExecution: unknown }[] }
  expect(source.data[0]).toMatchObject({ id: 'capture', turnId: 'turn', commandExecution: { command: 'echo captured', status: 'failed', exitCode: 1, cwd: '/project', aggregatedOutput: 'captured output' } })
  expect(await (await fetch(`${route}&view=command-output&limit=6`)).json()).toEqual({ data: { text: 'output', offset: 9, totalLength: 15, nextOffset: null } })
  expect(rpc).not.toHaveBeenCalled()
})

it('restores both synthetic and evicted native command sources from the verified session', async () => {
  directory = await mkdtemp(join(tmpdir(), 'codexui-source-'))
  const sessions = join(directory, 'sessions')
  await mkdir(sessions)
  vi.stubEnv('CODEX_HOME', directory)
  const path = join(sessions, 'thread.jsonl')
  const rows = [
    { type: 'session_meta', payload: { id: 'thread' } },
    { type: 'turn_context', payload: { turn_id: 'turn' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'saved-call', arguments: '{"cmd":"echo saved"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'saved-call', output: 'Process exited with code 2\nOutput:\nsaved output' } },
  ]
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n'))
  vi.spyOn(AppServerProcess.prototype, 'getThreadSessionPath').mockReturnValue(path)
  vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ data: [], nextCursor: null })
  const base = await start()
  for (const itemId of ['session-cmd-saved-call', 'saved-call']) {
    const route = `${base}/codex-api/thread-resource-source?threadId=thread&turnId=turn&itemId=${itemId}`
    const source = await (await fetch(route)).json() as { data: { commandExecution: unknown }[] }
    expect(source.data[0]).toMatchObject({ id: itemId, turnId: 'turn', commandExecution: { command: 'echo saved', status: 'failed', exitCode: 2, aggregatedOutput: 'saved output' } })
    expect(await (await fetch(`${route}&view=command-output&offset=0&limit=5`)).json()).toEqual({ data: { text: 'saved', offset: 0, totalLength: 12, nextOffset: 5 } })
  }
})

it.each([true, false])('refreshes a stale saved path at most once and respects metadata policy (allowed=%s)', async (allowed) => {
  directory = await mkdtemp(join(tmpdir(), 'codexui-moved-source-'))
  const archived = join(directory, 'archived_sessions')
  await mkdir(archived)
  vi.stubEnv('CODEX_HOME', directory)
  const path = join(archived, 'thread.jsonl')
  const rows = [
    { type: 'session_meta', payload: { id: 'moved-thread' } },
    { type: 'turn_context', payload: { turn_id: 'turn' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'moved-call', arguments: '{"cmd":"echo moved"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'moved-call', output: 'Output:\nmoved output' } },
  ]
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n'))
  vi.spyOn(AppServerProcess.prototype, 'getThreadSessionPath').mockReturnValue(join(directory, 'sessions', 'moved-away.jsonl'))
  const remember = vi.spyOn(AppServerProcess.prototype, 'rememberThreadSessionPath')
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ thread: { id: 'moved-thread', path } })
  const base = await start(() => allowed)
  const route = `${base}/codex-api/thread-resource-source?threadId=moved-thread&turnId=turn&itemId=session-cmd-moved-call&view=command-output`
  const response = await fetch(route)
  expect(response.status).toBe(allowed ? 200 : 404)
  if (allowed) {
    expect(await response.json()).toEqual({ data: { text: 'moved output', offset: 0, totalLength: 12, nextOffset: null } })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/read', { threadId: 'moved-thread', includeTurns: false })
    expect(remember).toHaveBeenCalledWith('moved-thread', path)
  } else {
    expect(rpc).not.toHaveBeenCalled()
  }
})

it('does not loop metadata refresh when the replacement saved path is also missing', async () => {
  vi.spyOn(AppServerProcess.prototype, 'getThreadSessionPath').mockReturnValue('/missing/old.jsonl')
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ thread: { path: '/missing/new.jsonl' } })
  const base = await start()
  const response = await fetch(`${base}/codex-api/thread-resource-source?threadId=thread&turnId=turn&itemId=session-cmd-missing&view=command-output`)
  expect(response.status).toBe(404)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/read', { threadId: 'thread', includeTurns: false })
})
