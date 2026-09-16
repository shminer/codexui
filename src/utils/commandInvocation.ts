import { spawnSync } from 'node:child_process'
import { basename, extname } from 'node:path'

const WINDOWS_CMD_NAMES = new Set(['codex', 'npm', 'npx'])

export type SpawnInvocation = {
  command: string
  args: string[]
  shell?: true
}

function needsWindowsCommandShell(command: string, platform = process.platform): boolean {
  if (platform !== 'win32') {
    return false
  }

  const lowerCommand = command.toLowerCase()
  const baseName = basename(lowerCommand)
  if (/\.(cmd|bat)$/i.test(baseName)) {
    return true
  }

  if (extname(baseName)) {
    return false
  }

  return WINDOWS_CMD_NAMES.has(baseName)
}

export function getSpawnInvocation(command: string, args: string[] = [], platform = process.platform): SpawnInvocation {
  if (needsWindowsCommandShell(command, platform)) {
    return { command, args, shell: true }
  }

  return { command, args }
}

export function spawnSyncCommand(
  command: string,
  args: string[] = [],
  options: Parameters<typeof spawnSync>[2] = {},
) {
  const invocation = getSpawnInvocation(command, args)
  return spawnSync(invocation.command, invocation.args, {
    ...options,
    ...(invocation.shell ? { shell: true } : {}),
  })
}
