import { createReadStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'

export type PersistedCommandTarget = { itemId: string; turnId: string; command?: string }
export type PersistedCommandOutput = { text: string; command: string; exitCode?: number | null; status?: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function readPersistedCommandOutputs(
  path: string,
  roots: string[],
  threadId: string,
  targets: PersistedCommandTarget[],
  cleanOutput: (raw: string) => string | Omit<PersistedCommandOutput, 'command'>,
  isCancelled: () => boolean = () => false,
): Promise<Map<string, PersistedCommandOutput>> {
  const outputs = new Map<string, PersistedCommandOutput>()
  const canonicalPath = await realpath(path)
  let allowed = false
  for (const root of roots) {
    const canonicalRoot = await realpath(root).catch(() => '')
    if (!canonicalRoot) continue
    const rel = relative(canonicalRoot, canonicalPath)
    if (rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) allowed = true
  }
  if (!allowed) return outputs
  const wanted = new Map(targets.map((target) => [target.itemId, target]))
  const calls = new Map<string, { target: PersistedCommandTarget; command: string }>()
  const input = createReadStream(canonicalPath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let verifiedThread = false
  let currentTurnId = ''
  try {
    for await (const line of lines) {
      if (isCancelled()) break
      let row: Record<string, unknown> | null
      try { row = record(JSON.parse(line)) } catch { continue }
      const payload = record(row?.payload)
      if (row?.type === 'session_meta') {
        if (payload?.id !== threadId) return new Map()
        verifiedThread = true
        continue
      }
      if (!verifiedThread || !payload) continue
      if (row?.type === 'turn_context' || (row?.type === 'event_msg' && payload.type === 'task_started')) {
        if (typeof payload.turn_id === 'string') currentTurnId = payload.turn_id
        continue
      }
      if (row?.type !== 'response_item' || !currentTurnId) continue
      if (payload.type === 'commandExecution' && typeof payload.id === 'string') {
        const target = wanted.get(payload.id)
        if (target?.turnId === currentTurnId && typeof payload.aggregatedOutput === 'string' && payload.status !== 'inProgress') {
          outputs.set(target.itemId, {
            text: payload.aggregatedOutput,
            command: typeof payload.command === 'string' ? payload.command : '',
            exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : null,
            status: typeof payload.status === 'string' ? payload.status : 'completed',
          })
        }
      }
      if (payload.type === 'function_call' && payload.name === 'exec_command' && typeof payload.call_id === 'string') {
        const callId = payload.call_id
        const target = wanted.get(`session-cmd-${callId}`) ?? wanted.get(typeof payload.id === 'string' ? payload.id : '') ?? wanted.get(callId)
        if (!target || target.turnId !== currentTurnId) continue
        let command = ''
        try {
          const args = record(JSON.parse(typeof payload.arguments === 'string' ? payload.arguments : '{}'))
          command = typeof args?.cmd === 'string' ? args.cmd : ''
        } catch { continue }
        if (target.command !== undefined && target.command !== command) continue
        calls.set(callId, { target, command })
      }
      if (payload.type === 'function_call_output' && typeof payload.call_id === 'string' && typeof payload.output === 'string') {
        const call = calls.get(payload.call_id)
        if (call?.target.turnId === currentTurnId) {
          const parsed = cleanOutput(payload.output)
          outputs.set(call.target.itemId, { ...(typeof parsed === 'string' ? { text: parsed } : parsed), command: call.command })
        }
      }
      if (outputs.size === wanted.size) break
    }
  } finally {
    lines.close()
    input.destroy()
  }
  return outputs
}
