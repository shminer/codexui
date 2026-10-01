import { createServer as createHttpServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeLocalPathForUrl } from '../pathUtils'
import { createServer } from './httpServer'
import { decodeBrowsePath, normalizeLocalPath } from './localBrowseUi'
import { buildSafeSecurityPolicy, type ServerSecurityPolicy } from './securityPolicy'
import { loadSafeRuntimeConfig } from '../safe/runtimePolicy'

vi.mock('./codexAppServerBridge.js', () => ({
  createCodexBridgeMiddleware: () => Object.assign(
    (_req: unknown, _res: unknown, next: () => void) => next(),
    { dispose: () => {}, subscribeNotifications: () => () => {} },
  ),
}))

describe('local filesystem HTTP routes', () => {
  let root: string
  let server: Server | undefined
  let dispose: (() => void) | undefined
  let base: string
  const browse = (path: string) => `/codex-local-browse${encodeLocalPathForUrl(path)}`
  const edit = (path: string) => `/codex-local-edit${encodeLocalPathForUrl(path)}`

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'codex-local-paths-')))
  })
  afterEach(async () => {
    dispose?.()
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
    server = undefined
    await rm(root, { recursive: true, force: true })
  })
  async function start(securityPolicy?: ServerSecurityPolicy) {
    const instance = createServer({ securityPolicy })
    dispose = instance.dispose
    server = createHttpServer(instance.app)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
    base = `http://127.0.0.1:${address.port}`
  }

  it('round-trips directory navigation, literal percent names and editing', async () => {
    const folder = join(root, '\u6d4b\u8bd5 # %20')
    const file = join(folder, 'notes # %20.txt')
    await mkdir(folder)
    await writeFile(file, 'original')
    await start()

    expect(decodeBrowsePath(encodeLocalPathForUrl(file))).toBe(file)
    expect(normalizeLocalPath(pathToFileURL(file).href)).toBe(file)
    const listing = await fetch(`${base}/codex-local-directories?${new URLSearchParams({ path: root })}`).then((r) => r.json())
    expect(listing.data).toMatchObject({ path: root, parentPath: dirname(root), entries: [{ path: folder }] })
    const directoryHtml = await fetch(base + browse(folder)).then((r) => r.text())
    expect(directoryHtml).toContain(`href="${browse(file)}"`)
    expect(directoryHtml).toContain(`href="${browse(root)}"`)
    expect(directoryHtml).toContain(`href="${edit(file)}"`)
    expect(await fetch(base + browse(file)).then((r) => r.text())).toBe('original')
    const editor = await fetch(base + edit(file))
    expect(editor.status).toBe(200)
    expect(await editor.text()).toContain('original')
    const saved = await fetch(base + edit(file), { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'updated' })
    expect(saved.status).toBe(200)
    expect(await readFile(file, 'utf8')).toBe('updated')
    expect((await fetch(base + browse(join(folder, 'missing.txt')))).status).toBe(404)
    if (process.platform !== 'win32') {
      const unusual = join(folder, 'a?b\\c.txt')
      await writeFile(unusual, 'linux filename')
      expect(await fetch(base + browse(unusual)).then((r) => r.text())).toBe('linux filename')
      expect((await fetch(base + browse('/'))).status).toBe(200)
    } else {
      expect((await fetch(base + browse(parse(root).root))).status).toBe(200)
    }
  })

  it('serves file URLs, images and HTML relative assets', async () => {
    const page = join(root, 'index.html')
    const image = join(root, 'image # %20.png')
    await writeFile(page, '<img src="asset.txt">')
    await writeFile(join(root, 'asset.txt'), 'relative asset')
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'))
    await start()
    expect(await fetch(`${base}/codex-local-file?${new URLSearchParams({ path: pathToFileURL(page).href })}`).then((r) => r.text())).toContain('<img')
    const response = await fetch(`${base}/codex-local-image?${new URLSearchParams({ path: pathToFileURL(image).href })}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(image))
    const assetUrl = new URL('asset.txt', base + browse(page))
    expect(await fetch(assetUrl).then((r) => r.text())).toBe('relative asset')
  })

  it('preserves safe allowed-root checks and disabled editing', async () => {
    const allowed = join(root, 'allowed')
    const outside = join(root, 'outside')
    await mkdir(allowed)
    await mkdir(outside)
    const file = join(allowed, 'notes.txt')
    const secret = join(outside, 'secret.txt')
    await writeFile(file, 'allowed')
    await writeFile(secret, 'secret')
    await symlink(outside, join(allowed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const policy = buildSafeSecurityPolicy({ ...loadSafeRuntimeConfig({}), allowedRoots: [allowed] })
    await start(policy)
    expect((await fetch(base + browse(file))).status).toBe(200)
    expect((await fetch(base + browse(secret))).status).toBe(403)
    expect((await fetch(base + browse(join(allowed, 'escape', 'secret.txt')))).status).toBe(403)
    expect((await fetch(base + edit(file))).status).toBe(403)
    expect((await fetch(base + edit(file), { method: 'PUT', body: 'rejected' })).status).toBe(403)
    expect(await readFile(file, 'utf8')).toBe('allowed')
  })
})
