import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getCodexCommandCandidates, resolveCodexCommand } from './commandResolution'

const temporaryRoots: string[] = []
const originalCodexCommand = process.env.CODEXUI_CODEX_COMMAND
afterEach(async () => {
  if (originalCodexCommand === undefined) delete process.env.CODEXUI_CODEX_COMMAND
  else process.env.CODEXUI_CODEX_COMMAND = originalCodexCommand
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

    expect(getCodexCommandCandidates('win32', 'arm64', [prefix])).toEqual([
      'codex.exe',
      join(packageDir, 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'),
      'codex',
    ])
  })

  it('keeps the explicit command override ahead of automatic discovery', () => {
    process.env.CODEXUI_CODEX_COMMAND = process.execPath
    expect(resolveCodexCommand('win32', 'x64')).toBe(process.execPath)
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
  })
})
