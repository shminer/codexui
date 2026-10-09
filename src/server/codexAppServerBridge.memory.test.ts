import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AppServerProcess, createCodexBridgeMiddleware } from './codexAppServerBridge'
import { PERMISSIVE_SECURITY_POLICY } from './securityPolicy'

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

async function start(allowRead: () => boolean = () => true) {
  bridge = createCodexBridgeMiddleware({ securityPolicy: {
    ...PERMISSIVE_SECURITY_POLICY,
    backgroundIntegrationsEnabled: false,
    isRpcMethodAllowed: (method) => method !== 'thread/read' || allowRead(),
  } })
  server = createServer((req, res) => { void bridge!(req, res, () => res.end()) })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test listener')
  return `http://127.0.0.1:${address.port}`
}

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
