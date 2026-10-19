import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readManualModelIds, updateManualModelId } from './codexAppServerBridge'

let codexHome: string
beforeEach(async () => {
  codexHome = await mkdtemp(join(tmpdir(), 'codex-manual-models-'))
  vi.stubEnv('CODEX_HOME', codexHome)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(codexHome, { recursive: true, force: true })
})

describe('persisted manual model IDs', () => {
  it('persists case-sensitive model IDs, deduplicates and preserves unrelated state', async () => {
    const statePath = join(codexHome, '.codex-global-state.json')
    await writeFile(statePath, JSON.stringify({ untouched: { nested: true } }))
    expect(await readManualModelIds()).toEqual([])
    await updateManualModelId(' vendor/model:latest ')
    await updateManualModelId('vendor/model:latest')
    await updateManualModelId('Vendor/model:latest')
    expect(await readManualModelIds()).toEqual(['vendor/model:latest', 'Vendor/model:latest'])
    expect(JSON.parse(await readFile(statePath, 'utf8')).untouched).toEqual({ nested: true })
    await updateManualModelId('vendor/model:latest', true)
    await updateManualModelId('vendor/model:latest', true)
    expect(await readManualModelIds()).toEqual(['Vendor/model:latest'])
  })

  it('serializes concurrent changes without overwriting another device add or removal', async () => {
    await Promise.all(['a', 'b', 'c'].map((id) => updateManualModelId(id)))
    await Promise.all([updateManualModelId('a', true), updateManualModelId('d'), updateManualModelId('b', true)])
    expect(await readManualModelIds()).toEqual(['c', 'd'])
  })

  it.each([null, 1, {}, '', '  ', 'bad\nmodel', 'bad\tmodel', 'bad\u0000model', 'bad\u007fmodel'])('rejects invalid model ID %j', async (value) => {
    await expect(updateManualModelId(value)).rejects.toThrow('valid model ID')
    expect(await readManualModelIds()).toEqual([])
  })
})
