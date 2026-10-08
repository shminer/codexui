import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createServer as createApp } from './httpServer'
import { PERMISSIVE_SECURITY_POLICY } from './securityPolicy'

it.each([false, true])('preserves encoded filenames and the write gate (editing=%s)', async (editing) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-file-routes-'))
  const path = join(root, 'source%20 #中文.cpp')
  const otherPath = join(root, 'source  #中文.cpp')
  await writeFile(path, 'original')
  await writeFile(otherPath, 'untouched')
  const runtime = createApp({ securityPolicy: {
    ...PERMISSIVE_SECURITY_POLICY,
    backgroundIntegrationsEnabled: false,
    fileEditingEnabled: editing,
    resolveLocalPath: async (value) => value === path ? path : null,
  } })
  const server = createServer(runtime.app)
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    const base = `http://127.0.0.1:${port}`
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const opened = await fetch(`${base}/codex-local-open?${new URLSearchParams({ path })}`)
    expect(opened.status).toBe(200)
    expect(await opened.text()).toContain(`editor.setReadOnly(${!editing})`)
    expect(await (await fetch(`${base}/codex-local-browse${encoded}`)).text()).toBe('original')
    expect((await fetch(`${base}/codex-local-edit${encoded}`)).status).toBe(200)
    const saved = await fetch(`${base}/codex-local-edit${encoded}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'updated' })
    expect(saved.status).toBe(editing ? 200 : 403)
    expect(await readFile(path, 'utf8')).toBe(editing ? 'updated' : 'original')
    expect(await readFile(otherPath, 'utf8')).toBe('untouched')
    expect((await fetch(`${base}/codex-local-open?${new URLSearchParams({ path: otherPath })}`)).status).toBe(403)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    runtime.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
