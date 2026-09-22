import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null
}

const MAX_TAIL_BYTES = 16 * 1024 * 1024
const TAIL_CHUNK_BYTES = 64 * 1024

export async function readRecentThreadTurns(path: string, sessionsRoot: string, threadId: string, limit = 10): Promise<{
  turns: RecordValue[]
  hasMoreOlder: boolean
} | null> {
  const root = await realpath(sessionsRoot)
  const file = await realpath(path)
  const withinRoot = relative(root, file)
  if (!withinRoot || isAbsolute(withinRoot) || withinRoot === '..' || withinRoot.startsWith(`..${sep}`)) return null
  if (!file.endsWith(`-${threadId}.jsonl`)) return null

  const handle = await open(file, 'r')
  try {
    const size = (await handle.stat()).size
    let offset = size
    let tailBytes = 0
    const chunks: Buffer[] = []
    let prefix = Buffer.alloc(0)
    let starts = 0
    while (offset > 0 && tailBytes < MAX_TAIL_BYTES && starts <= limit) {
      const bytes = Math.min(TAIL_CHUNK_BYTES, offset, MAX_TAIL_BYTES - tailBytes)
      offset -= bytes
      const chunk = Buffer.allocUnsafe(bytes)
      if ((await handle.read(chunk, 0, bytes, offset)).bytesRead !== bytes) return null
      const scan = Buffer.concat([chunk, prefix]).toString('utf8')
      starts += [...scan.matchAll(/"type":"task_started"/gu)].filter((match) => (match.index ?? bytes) < bytes).length
      prefix = chunk.subarray(0, 32)
      chunks.unshift(chunk)
      tailBytes += bytes
    }
    if (offset > 0 && starts <= limit) return null

    // The first line may start in the middle of a UTF-8 character or JSON row.
    const raw = Buffer.concat(chunks).toString('utf8')
    const lines = (offset > 0 ? raw.slice(raw.indexOf('\n') + 1) : raw).split('\n')
    const turns: RecordValue[] = []
    let current: RecordValue | null = null
    for (const line of lines) {
      if (!line) continue
      let row: RecordValue | null
      try { row = record(JSON.parse(line)) } catch { continue }
      if (!row) continue
      const payload = record(row.payload)
      if (row.type === 'event_msg' && payload?.type === 'task_started' && typeof payload.turn_id === 'string') {
        current = { id: payload.turn_id, status: 'completed', items: [] }
        turns.push(current)
      } else if (row.type === 'event_msg' && payload?.type === 'task_complete' && current) {
        current.status = 'completed'
      } else if (row.type === 'response_item' && current && payload) {
        const items = current.items as RecordValue[]
        const id = typeof payload.id === 'string' ? payload.id : ''
        if (payload.type === 'message' && id) {
          const content = Array.isArray(payload.content) ? payload.content : []
          const text = content.map((part) => {
            const block = record(part)
            return block?.type === 'input_text' || block?.type === 'output_text' ? block.text : ''
          }).filter((part): part is string => typeof part === 'string').join('\n')
          if (payload.role === 'user') items.push({ id, type: 'userMessage', content: [{ type: 'text', text }], createdAtIso: row.timestamp })
          if (payload.role === 'assistant' && text) items.push({ id, type: 'agentMessage', text, createdAtIso: row.timestamp })
        }
      } else if (row.type === 'compacted' && current) {
        (current.items as RecordValue[]).push({ id: `compaction-${row.ordinal}`, type: 'contextCompaction', createdAtIso: row.timestamp })
      }
    }
    if (turns.length === 0) return null
    return { turns: turns.slice(-limit), hasMoreOlder: offset > 0 || turns.length > limit }
  } finally {
    await handle.close()
  }
}
