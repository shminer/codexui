import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getCurrentCommandMarker,
  getSafeHome,
  getStatePath,
  readLiveManagedState,
  readManagedState,
  writeManagedState,
  type ManagedState,
} from './state'

const originalHome = process.env.CODEX_MOBILE_SAFE_HOME

afterEach(() => {
  if (originalHome === undefined) delete process.env.CODEX_MOBILE_SAFE_HOME
  else process.env.CODEX_MOBILE_SAFE_HOME = originalHome
})

function state(): ManagedState {
  return {
    pid: 1234,
    port: 5900,
    bindHost: '127.0.0.1',
    startedAt: '2026-07-12T00:00:00.000Z',
    accessMode: 'local',
    externalExposure: 'disabled',
    passwordProtected: true,
    commandMarker: '/home/user/.local/bin/codex-mobile-safe',
  }
}

describe('managed safe state', () => {
  it('uses the new command name while retaining the existing state location', () => {
    delete process.env.CODEX_MOBILE_SAFE_HOME
    expect(getSafeHome()).toMatch(/\.codex-mobile-safe$/u)
    expect(getCurrentCommandMarker([])).toBe('codexui-safe')
    expect(getCurrentCommandMarker(['node', 'codexui-safe'])).toBe('codexui-safe')
  })

  it('writes mode-restricted JSON and returns a matching live process', async () => {
    process.env.CODEX_MOBILE_SAFE_HOME = await mkdtemp(join(tmpdir(), 'codex-safe-state-'))
    await writeManagedState(state())
    expect(getStatePath()).toContain(process.env.CODEX_MOBILE_SAFE_HOME)
    expect(readManagedState()).toEqual(state())
    await expect(readLiveManagedState(() => 'node /home/user/.local/bin/codex-mobile-safe start')).resolves.toEqual(state())
  })

  it('clears stale state when the PID is missing or marker mismatches', async () => {
    process.env.CODEX_MOBILE_SAFE_HOME = await mkdtemp(join(tmpdir(), 'codex-safe-state-'))
    await writeManagedState(state())
    await expect(readLiveManagedState(() => null)).resolves.toBeNull()
    expect(readManagedState()).toBeNull()

    await writeManagedState(state())
    await expect(readLiveManagedState(() => 'node unrelated-service')).resolves.toBeNull()
    expect(readManagedState()).toBeNull()
  })
})
