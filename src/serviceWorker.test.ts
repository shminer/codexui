import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

it('does not cache the popup document as the offline app shell', () => {
  const handlers = new Map<string, (event: unknown) => void>()
  const caches = { open: vi.fn() }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'http://localhost' }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) },
    URL, caches,
  })
  const respondWith = vi.fn()
  handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'http://localhost/side-conversation.html' }, respondWith })
  expect(respondWith).not.toHaveBeenCalled()
  expect(caches.open).not.toHaveBeenCalled()
})
