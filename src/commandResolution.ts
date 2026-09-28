import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join, parse } from 'node:path'
import { spawnSyncCommand } from './utils/commandInvocation.js'

export type CommandInvocation = {
  command: string
  args: string[]
}

export type CodexCommandResolution = {
  command: string
  env?: Record<string, string | undefined>
}

const CODEX_MANAGED_BY_ENV_NAMES = [
  'CODEX_MANAGED_BY_NPM',
  'CODEX_MANAGED_BY_PNPM',
  'CODEX_MANAGED_BY_BUN',
  'CODEX_MANAGED_BY_VITE_PLUS',
] as const

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const unique: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || unique.includes(normalized)) continue
    unique.push(normalized)
  }
  return unique
}

function isPathLike(command: string): boolean {
  return command.includes('/') || command.includes('\\') || /^[a-zA-Z]:/.test(command)
}

function isRunnableCommand(command: string, args: string[] = []): boolean {
  if (isPathLike(command) && !existsSync(command)) {
    return false
  }
  return canRunCommand(command, args)
}

function getWindowsAppDataNpmPrefix(): string | null {
  const appData = process.env.APPDATA?.trim()
  return appData ? join(appData, 'npm') : null
}

function getPotentialNpmPrefixes(platform = process.platform): string[] {
  return uniqueStrings([
    process.env.npm_config_prefix,
    process.env.PREFIX,
    getUserNpmPrefix(),
    platform === 'win32' ? getWindowsAppDataNpmPrefix() : null,
    ...(platform === 'win32' ? getWindowsPathNpmPrefixes() : []),
  ])
}

function getWindowsPathNpmPrefixes(pathValue = process.env.PATH ?? ''): string[] {
  return uniqueStrings(pathValue.split(delimiter).map((entry) => {
    const normalized = entry.trim().replace(/^"|"$/g, '')
    if (!normalized) return null
    return existsSync(join(normalized, 'codex.cmd')) || existsSync(join(normalized, 'codex'))
      ? normalized
      : null
  }))
}

function getPotentialCodexPackageDirs(prefix: string, platform = process.platform): string[] {
  const dirs = [join(prefix, 'node_modules', '@openai', 'codex')]
  if (platform !== 'win32') {
    dirs.push(join(prefix, 'lib', 'node_modules', '@openai', 'codex'))
  }
  return dirs
}

function getPotentialCodexExecutables(prefix: string, platform = process.platform): string[] {
  return getPotentialCodexPackageDirs(prefix, platform).map((packageDir) => join(packageDir, 'bin', 'codex'))
}

const WINDOWS_CODEX_TARGETS: Partial<Record<NodeJS.Architecture, { packageName: string; targetTriple: string }>> = {
  x64: { packageName: '@openai/codex-win32-x64', targetTriple: 'x86_64-pc-windows-msvc' },
  arm64: { packageName: '@openai/codex-win32-arm64', targetTriple: 'aarch64-pc-windows-msvc' },
}

function getPotentialWindowsCodexExecutables(prefix: string, arch: NodeJS.Architecture): string[] {
  const target = WINDOWS_CODEX_TARGETS[arch]
  if (!target) return []

  return getPotentialCodexPackageDirs(prefix, 'win32').map((packageDir) => {
    let vendorRoot = join(packageDir, 'vendor')
    try {
      const requireFromCodex = createRequire(join(packageDir, 'package.json'))
      vendorRoot = join(dirname(requireFromCodex.resolve(`${target.packageName}/package.json`)), 'vendor')
    } catch {
      // The official launcher also falls back to a vendor directory in the main package.
    }
    return join(vendorRoot, target.targetTriple, 'bin', 'codex.exe')
  })
}

function getManagedPackageEnv(packageRoot: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    CODEX_MANAGED_PACKAGE_ROOT: realpathSync(packageRoot),
  }
  for (const name of CODEX_MANAGED_BY_ENV_NAMES) env[name] = undefined

  const normalizedRoot = packageRoot.replace(/\\/g, '/')
  let marker: typeof CODEX_MANAGED_BY_ENV_NAMES[number] = 'CODEX_MANAGED_BY_NPM'
  if (normalizedRoot.includes('/.bun/install/global/')) {
    marker = 'CODEX_MANAGED_BY_BUN'
  } else {
    const canonicalRoot = realpathSync(packageRoot)
    const filesystemRoot = parse(packageRoot).root
    for (let current = packageRoot; current !== filesystemRoot; current = dirname(current)) {
      const nodeModulesDir = join(current, 'node_modules')
      if (!existsSync(join(nodeModulesDir, '.modules.yaml'))) continue
      try {
        if (realpathSync(join(nodeModulesDir, '@openai', 'codex')) === canonicalRoot) {
          marker = 'CODEX_MANAGED_BY_PNPM'
          break
        }
      } catch {}
    }
  }
  env[marker] = '1'
  return env
}

function getCodexCommandResolutions(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  prefixes: string[],
): Array<CodexCommandResolution & { packageRoot?: string }> {
  if (platform !== 'win32') {
    return getCodexCommandCandidates(platform, arch, prefixes).map((command) => ({ command }))
  }

  const nativeCandidates = prefixes.flatMap((prefix) => {
    const packageDirs = getPotentialCodexPackageDirs(prefix, 'win32')
    const executables = getPotentialWindowsCodexExecutables(prefix, arch)
    return executables.map((command, index) => ({
      command,
      packageRoot: packageDirs[index],
    }))
  })
  return [{ command: 'codex.exe' }, ...nativeCandidates, { command: 'codex' }]
}

export function getCodexCommandCandidates(
  platform = process.platform,
  arch = process.arch,
  prefixes = getPotentialNpmPrefixes(platform),
): string[] {
  if (platform === 'win32') {
    return ['codex.exe', ...prefixes.flatMap((prefix) => getPotentialWindowsCodexExecutables(prefix, arch)), 'codex']
  }
  return ['codex', ...prefixes.flatMap((prefix) => getPotentialCodexExecutables(prefix, platform))]
}

function getPotentialRipgrepExecutables(prefix: string): string[] {
  return getPotentialCodexPackageDirs(prefix).map((packageDir) => (
    process.platform === 'win32'
      ? join(
          packageDir,
          'node_modules',
          '@openai',
          'codex-win32-x64',
          'vendor',
          'x86_64-pc-windows-msvc',
          'path',
          'rg.exe',
        )
      : join(packageDir, 'bin', 'rg')
  ))
}

export function canRunCommand(command: string, args: string[] = []): boolean {
  const result = spawnSyncCommand(command, args, {
    stdio: 'ignore',
    windowsHide: true,
  })
  return !result.error && result.status === 0
}

export function getUserNpmPrefix(): string {
  return join(homedir(), '.npm-global')
}

export function getNpmGlobalBinDir(prefix: string): string {
  return process.platform === 'win32' ? prefix : join(prefix, 'bin')
}

export function prependPathEntry(existingPath: string, entry: string): string {
  const normalizedEntry = entry.trim()
  if (!normalizedEntry) return existingPath

  const parts = existingPath
    .split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean)

  if (parts.includes(normalizedEntry)) {
    return existingPath
  }

  return existingPath ? `${normalizedEntry}${delimiter}${existingPath}` : normalizedEntry
}

export function resolveCodexCommand(platform = process.platform, arch = process.arch): string | null {
  return resolveCodexCommandResolution(platform, arch)?.command ?? null
}

export function resolveCodexCommandResolution(
  platform = process.platform,
  arch = process.arch,
  probe: (command: string, args?: string[]) => boolean = isRunnableCommand,
  prefixes = getPotentialNpmPrefixes(platform),
): CodexCommandResolution | null {
  const explicit = process.env.CODEXUI_CODEX_COMMAND?.trim()
  if (explicit && probe(explicit, ['--version'])) return { command: explicit }

  for (const candidate of getCodexCommandResolutions(platform, arch, prefixes)) {
    if (probe(candidate.command, ['--version'])) {
      return candidate.packageRoot
        ? { command: candidate.command, env: getManagedPackageEnv(candidate.packageRoot) }
        : { command: candidate.command }
    }
  }

  return null
}

export function getCodexSpawnEnv(
  resolution: CodexCommandResolution,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!resolution.env) return baseEnv
  const env = { ...baseEnv }
  for (const [name, value] of Object.entries(resolution.env)) {
    if (value === undefined) delete env[name]
    else env[name] = value
  }
  return env
}

export function applyCodexCommandResolution(resolution: CodexCommandResolution): void {
  process.env.CODEXUI_CODEX_COMMAND = resolution.command
  if (!resolution.env) return
  for (const [name, value] of Object.entries(resolution.env)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

export function resolveRipgrepCommand(): string | null {
  const explicit = process.env.CODEXUI_RG_COMMAND?.trim()
  const packageCandidates = getPotentialNpmPrefixes().flatMap(getPotentialRipgrepExecutables)
  const fallbackCandidates = process.platform === 'win32'
    ? [...packageCandidates, 'rg']
    : ['rg', ...packageCandidates]

  for (const candidate of uniqueStrings([explicit, ...fallbackCandidates])) {
    if (isRunnableCommand(candidate, ['--version'])) {
      return candidate
    }
  }

  return null
}

export function resolvePythonCommand(): CommandInvocation | null {
  const candidates: CommandInvocation[] = process.platform === 'win32'
    ? [
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
        { command: 'python3', args: [] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ]

  for (const candidate of candidates) {
    if (isRunnableCommand(candidate.command, [...candidate.args, '--version'])) {
      return candidate
    }
  }

  return null
}

export function resolveSkillInstallerScriptPath(codexHome?: string): string | null {
  const normalizedCodexHome = codexHome?.trim()
  const candidates = uniqueStrings([
    normalizedCodexHome
      ? join(normalizedCodexHome, 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py')
      : null,
    process.env.CODEX_HOME?.trim()
      ? join(process.env.CODEX_HOME.trim(), 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py')
      : null,
    join(homedir(), '.codex', 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py'),
    join(homedir(), '.cursor', 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py'),
  ])

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}
