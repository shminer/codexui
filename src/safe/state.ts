import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type ManagedState = {
  pid: number
  port: number
  bindHost: string
  startedAt: string
  accessMode: 'local' | 'lan'
  externalExposure: 'disabled' | 'tailscale'
  passwordProtected: boolean
  commandMarker: string
  tailscaleUrl?: string
}

export type ProcessCommandReader = (pid: number) => string | null

export function getSafeHome(): string {
  return process.env.CODEX_MOBILE_SAFE_HOME?.trim() || join(homedir(), '.codex-mobile-safe')
}

export function getCurrentCommandMarker(argv: string[] = process.argv): string {
  const scriptPath = argv[1]?.trim()
  if (!scriptPath) return 'codexui-safe'
  return scriptPath.includes('/') || scriptPath.includes('\\') ? resolve(scriptPath) : scriptPath
}

export function getStatePath(): string {
  return join(getSafeHome(), 'state.json')
}

export function readManagedState(): ManagedState | null {
  const path = getStatePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ManagedState
    if (!parsed || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null
    if (!Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) return null
    if (typeof parsed.passwordProtected !== 'boolean') return null
    if (typeof parsed.commandMarker !== 'string' || !parsed.commandMarker.trim()) return null
    return parsed
  } catch {
    return null
  }
}

export function readProcessCommand(pid: number): string | null {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const command = result.stdout.trim()
  return command || null
}

export function isManagedProcessAlive(
  state: ManagedState,
  readCommand: ProcessCommandReader = readProcessCommand,
): boolean {
  const command = readCommand(state.pid)
  return Boolean(command && state.commandMarker.trim() && command.includes(state.commandMarker.trim()))
}

export async function readLiveManagedState(
  readCommand: ProcessCommandReader = readProcessCommand,
): Promise<ManagedState | null> {
  const state = readManagedState()
  if (!state) return null
  if (isManagedProcessAlive(state, readCommand)) return state
  await clearManagedState()
  return null
}

export async function writeManagedState(state: ManagedState): Promise<void> {
  const path = getStatePath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export async function clearManagedState(): Promise<void> {
  await rm(getStatePath(), { force: true })
}
