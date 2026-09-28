import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { AppServerProcess, createCodexBridgeMiddleware } from './codexAppServerBridge'
import { PERMISSIVE_SECURITY_POLICY } from './securityPolicy'

let httpServer: Server | undefined
let bridge: ReturnType<typeof createCodexBridgeMiddleware> | undefined

afterEach(async () => {
  bridge?.dispose()
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  vi.restoreAllMocks()
})

it.each([false, true])('metadata-only resume preserves history and page reads (pending=%s)', async (pending) => {
  const history = { thread: { id: 'thread', turns: [{ id: 'older' }, { id: 'recent' }] } }
  const metadata = { thread: { id: 'thread', model: 'thread-model', turns: [] } }
  let appServer!: AppServerProcess
  let finishPage!: (value: unknown) => void
  const pageResult = pending ? new Promise((resolve) => { finishPage = resolve }) : history
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockImplementation(async function (this: AppServerProcess, method) {
    appServer = this
    if (method === 'thread/resume') return metadata
    return rpc.mock.calls.length === 1 ? history : pageResult
  })
  const snapshots = vi.spyOn(AppServerProcess.prototype, 'storeThreadReadSnapshot')
  bridge = createCodexBridgeMiddleware({
    securityPolicy: { ...PERMISSIVE_SECURITY_POLICY, backgroundIntegrationsEnabled: false },
  })
  httpServer = createServer((req, res) => { void bridge!(req, res, () => { res.end() }) })
  await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Missing test listener')
  const postRpc = async (method: string, params: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/codex-api/rpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }),
    })
    expect(response.status).toBe(200)
    return response.json()
  }

  await postRpc('thread/read', { threadId: 'thread', includeTurns: true })
  const page = appServer.readThreadForTurnPage('thread')
  if (!pending) await page
  expect(await postRpc('thread/resume', { threadId: 'thread', excludeTurns: true })).toEqual({ result: metadata })
  expect(appServer.getLastThreadReadSnapshot('thread')).toEqual(history)
  expect(snapshots).toHaveBeenCalledTimes(1)
  if (pending) finishPage(history)
  expect(await page).toEqual(history)
  expect(await appServer.readThreadForTurnPage('thread')).toEqual(history)
  expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/read', 'thread/resume'])
})
