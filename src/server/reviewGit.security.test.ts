import { expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createServer as createApp } from './httpServer'
import { loadSafeRuntimeConfig } from '../safe/runtimePolicy'
import { buildSafeSecurityPolicy } from './securityPolicy'

it.each([false, true])('enforces allowed roots with file editing %s', async (fileEditing) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-review-safe-'))
  const originalCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = root
  const allowed = join(root, 'allowed')
  const outside = join(root, 'outside')
  await mkdir(allowed)
  await mkdir(outside)
  const runtime = createApp({ securityPolicy: buildSafeSecurityPolicy(loadSafeRuntimeConfig({ CODEX_MOBILE_SAFE_ALLOWED_ROOTS: allowed, CODEX_MOBILE_SAFE_FILE_EDITING: String(fileEditing) })) })
  const server = createServer(runtime.app)
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const base = `http://127.0.0.1:${address.port}`
    const init = (cwd: string) => fetch(`${base}/codex-api/review/git/init`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd }),
    })
    expect((await init(outside)).status).toBe(403)
    expect((await init(allowed)).status).toBe(fileEditing ? 200 : 403)
    for (const route of ['review/summary', 'review/snapshot', 'git/branches', 'git/repository-status']) {
      expect((await fetch(`${base}/codex-api/${route}?${new URLSearchParams({ cwd: outside })}`)).status).toBe(403)
    }
    const action = await fetch(`${base}/codex-api/review/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: outside, scope: 'workspace', action: 'revert', level: 'all' }),
    })
    expect(action.status).toBe(403)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    runtime.dispose()
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = originalCodexHome
    await rm(root, { recursive: true, force: true })
  }
})
