import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getCodexCommandCandidates,
  getCodexSpawnEnv,
  resolveCodexCommand,
  resolveCodexCommandResolution,
} from './commandResolution'

const temporaryRoots: string[] = []
const originalCodexCommand = process.env.CODEXUI_CODEX_COMMAND
const originalPath = process.env.PATH
const managedEnvNames = [
  'CODEX_MANAGED_PACKAGE_ROOT',
  'CODEX_MANAGED_BY_NPM',
  'CODEX_MANAGED_BY_PNPM',
  'CODEX_MANAGED_BY_BUN',
  'CODEX_MANAGED_BY_VITE_PLUS',
] as const
const originalManagedEnv = Object.fromEntries(managedEnvNames.map((name) => [name, process.env[name]]))

beforeEach(() => {
  delete process.env.CODEXUI_CODEX_COMMAND
})

afterEach(async () => {
  if (originalCodexCommand === undefined) delete process.env.CODEXUI_CODEX_COMMAND
  else process.env.CODEXUI_CODEX_COMMAND = originalCodexCommand
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  for (const name of managedEnvNames) {
    const value = originalManagedEnv[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function createPlatformPackage(packageName: string): Promise<{ prefix: string; packageDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'codex-command-'))
  temporaryRoots.push(root)
  const prefix = join(root, 'npm')
  const codexDir = join(prefix, 'node_modules', '@openai', 'codex')
  const packageDir = join(codexDir, 'node_modules', '@openai', packageName)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(codexDir, 'package.json'), '{"name":"@openai/codex"}')
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: `@openai/${packageName}` }))
  return { prefix, packageDir }
}

function nativeExecutable(packageDir: string, target: string): string {
  return join(packageDir, 'vendor', target, 'bin', 'codex.exe')
}

describe('Codex command resolution', () => {
  it('prefers the native Windows x64 executable before the command shim', async () => {
    const { prefix, packageDir } = await createPlatformPackage('codex-win32-x64')

    expect(getCodexCommandCandidates('win32', 'x64', [prefix])).toEqual([
      'codex.exe',
      join(packageDir, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
      'codex',
    ])
  })

  it('maps Windows arm64 to the matching native package', async () => {
    const { prefix, packageDir } = await createPlatformPackage('codex-win32-arm64')
    const executable = nativeExecutable(packageDir, 'aarch64-pc-windows-msvc')

    expect(getCodexCommandCandidates('win32', 'arm64', [prefix])).toEqual([
      'codex.exe',
      executable,
      'codex',
    ])
    expect(resolveCodexCommandResolution('win32', 'arm64', (command) => command === executable, [prefix])?.command)
      .toBe(executable)
  })

  it('keeps the explicit command override ahead of automatic discovery', () => {
    process.env.CODEXUI_CODEX_COMMAND = process.execPath
    expect(resolveCodexCommand('win32', 'x64')).toBe(process.execPath)
    expect(resolveCodexCommandResolution('win32', 'x64', (command) => command === process.execPath, [])).toEqual({
      command: process.execPath,
    })
  })

  it('returns the runnable native executable with the official managed-package environment', async () => {
    const { prefix, packageDir } = await createPlatformPackage('codex-win32-x64')
    const executable = nativeExecutable(packageDir, 'x86_64-pc-windows-msvc')
    const resolution = resolveCodexCommandResolution('win32', 'x64', (command) => command === executable, [prefix])

    expect(resolution?.command).toBe(executable)
    expect(getCodexSpawnEnv(resolution!, {
      CODEX_MANAGED_BY_PNPM: 'stale',
      CODEX_MANAGED_BY_BUN: 'stale',
      CODEX_MANAGED_BY_VITE_PLUS: 'stale',
    })).toMatchObject({
      CODEX_MANAGED_PACKAGE_ROOT: join(prefix, 'node_modules', '@openai', 'codex'),
      CODEX_MANAGED_BY_NPM: '1',
    })
    const env = getCodexSpawnEnv(resolution!, { CODEX_MANAGED_BY_PNPM: 'stale' })
    expect(env.CODEX_MANAGED_BY_PNPM).toBeUndefined()
    expect(env.CODEX_MANAGED_BY_BUN).toBeUndefined()
    expect(env.CODEX_MANAGED_BY_VITE_PLUS).toBeUndefined()
  })

  it('uses the shim only when native candidates are not runnable', async () => {
    const { prefix } = await createPlatformPackage('codex-win32-x64')
    expect(resolveCodexCommandResolution('win32', 'x64', (command) => command === 'codex', [prefix])).toEqual({
      command: 'codex',
    })
  })

  it('discovers a native executable from a PATH-only npm prefix', async () => {
    const { prefix, packageDir } = await createPlatformPackage('codex-win32-x64')
    await writeFile(join(prefix, 'codex.cmd'), '@echo off\r\n')
    process.env.PATH = [prefix, originalPath].filter(Boolean).join(delimiter)
    const executable = nativeExecutable(packageDir, 'x86_64-pc-windows-msvc')

    expect(resolveCodexCommandResolution('win32', 'x64', (command) => command === executable)?.command).toBe(executable)
  })

  it('does not fabricate managed-package variables for an explicit override', () => {
    process.env.CODEXUI_CODEX_COMMAND = 'custom-codex.exe'
    const baseEnv = { CODEX_MANAGED_BY_PNPM: 'caller-owned' }
    const resolution = resolveCodexCommandResolution('win32', 'x64', () => true, [])

    expect(resolution).toEqual({ command: 'custom-codex.exe' })
    expect(getCodexSpawnEnv(resolution!, baseEnv)).toBe(baseEnv)
  })

  it('falls back to PATH commands for unsupported Windows architectures', () => {
    expect(getCodexCommandCandidates('win32', 'ia32', [])).toEqual(['codex.exe', 'codex'])
  })

  it('keeps the existing Linux command and package-bin order', () => {
    const prefix = join('opt', 'npm')
    expect(getCodexCommandCandidates('linux', 'x64', [prefix])).toEqual([
      'codex',
      join(prefix, 'node_modules', '@openai', 'codex', 'bin', 'codex'),
      join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex'),
    ])
    expect(resolveCodexCommandResolution('linux', 'x64', (command) => command === 'codex', [prefix])).toEqual({
      command: 'codex',
    })
  })
})
