import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAllowedPath } from './pathPolicy'

describe('safe path policy', () => {
  it('accepts existing files inside an allowed root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-safe-root-'))
    const file = join(root, 'notes.txt')
    await writeFile(file, 'ok')

    await expect(resolveAllowedPath(file, [root])).resolves.toBe(await realpath(file))
  })

  it('rejects paths outside every allowed root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-safe-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'codex-safe-outside-'))
    const file = join(outside, 'secret.txt')
    await writeFile(file, 'secret')

    await expect(resolveAllowedPath(file, [root])).resolves.toBeNull()
  })

  it('rejects a symlink escape from an allowed root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-safe-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'codex-safe-outside-'))
    await mkdir(join(outside, 'nested'))
    const file = join(outside, 'nested', 'secret.txt')
    await writeFile(file, 'secret')
    await symlink(join(outside, 'nested'), join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveAllowedPath(join(root, 'escape', 'secret.txt'), [root])).resolves.toBeNull()
  })

  it('rejects relative and missing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-safe-root-'))
    await expect(resolveAllowedPath('relative.txt', [root])).resolves.toBeNull()
    await expect(resolveAllowedPath(join(root, 'missing.txt'), [root])).resolves.toBeNull()
  })
})
