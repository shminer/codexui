import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { AppServerProcess, createCodexBridgeMiddleware } from './codexAppServerBridge'
import { PERMISSIVE_SECURITY_POLICY } from './securityPolicy'

let server: Server | undefined
let bridge: ReturnType<typeof createCodexBridgeMiddleware> | undefined
afterEach(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  bridge?.dispose()
  vi.restoreAllMocks()
})

async function start(allowHistory = true): Promise<string> {
  bridge = createCodexBridgeMiddleware({ securityPolicy: {
    ...PERMISSIVE_SECURITY_POLICY,
    backgroundIntegrationsEnabled: false,
    isRpcMethodAllowed: () => allowHistory,
  } })
  server = createServer((req, res) => { void bridge!(req, res, () => res.end()) })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

it('returns paged resource metadata only, then reads a source item on demand', async () => {
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc').mockResolvedValue({ data: [
    { turnId: 'turn', item: { id: 'answer', type: 'agentMessage', text: 'PRIVATE [file](./source.cpp)' } },
    { turnId: 'turn', item: { id: 'image', type: 'imageGeneration', savedPath: '/project/image.png', result: 'data:image/png;base64,AAAA' } },
  ], nextCursor: 'older' })
  const base = await start()
  const response = await fetch(`${base}/codex-api/thread-resources?threadId=thread&cwd=/project&cursor=page`)
  expect(response.status).toBe(200)
  const page = await response.json()
  expect(page.nextCursor).toBe('older')
  expect(page.data.map((resource: { path: string }) => resource.path)).toEqual(['/project/source.cpp', '/project/image.png'])
  expect(JSON.stringify(page)).not.toMatch(/PRIVATE|base64/u)
  expect(rpc).toHaveBeenCalledWith('thread/items/list', { threadId: 'thread', cursor: 'page', limit: 50, sortDirection: 'desc' })
  const source = await fetch(`${base}/codex-api/thread-resource-source?threadId=thread&turnId=turn&itemId=answer`)
  expect((await source.json()).data[0]).toMatchObject({ id: 'answer', turnId: 'turn', text: 'PRIVATE [file](./source.cpp)' })
  expect(rpc).toHaveBeenLastCalledWith('thread/items/list', { threadId: 'thread', turnId: 'turn', cursor: null, limit: 50, sortDirection: 'asc' })
  rpc.mockResolvedValueOnce({ data: [], nextCursor: null })
  expect(await (await fetch(`${base}/codex-api/thread-resources?threadId=thread&cwd=/project&cursor=page`)).json()).toEqual({ data: [], nextCursor: null })
  expect(rpc).toHaveBeenCalledTimes(3)
})

it('enforces RPC policy for every projection route before accessing history', async () => {
  const rpc = vi.spyOn(AppServerProcess.prototype, 'rpc')
  const base = await start(false)
  for (const route of ['thread-resources', 'thread-collaboration', 'thread-resource-source']) {
    expect((await fetch(`${base}/codex-api/${route}?threadId=thread&turnId=turn&itemId=item`)).status).toBe(403)
  }
  expect(rpc).not.toHaveBeenCalled()
})
