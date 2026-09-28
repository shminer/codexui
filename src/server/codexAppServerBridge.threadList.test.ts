import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AppServerProcess } from './codexAppServerBridge'

describe('native thread list wiring', () => {
  it('preserves native list membership, order, and pagination without a second database list', async () => {
    const source = await readFile(new URL('./codexAppServerBridge.ts', import.meta.url), 'utf8')

    expect(source).toContain('callRpcWithArchiveRecovery(appServer, body.method, body.params ?? null)')
    expect(source).toContain('sanitizeThreadTurnsInlinePayloads(body.method, errorMergedResult)')
    expect(source).not.toContain('mergeImportedThreadsIntoThreadListResult')
    expect(source).not.toContain('listImportedThreadsFromStateDb')
    expect(source).toContain('registerImportedSessionsInStateDb(importedSessionRecords)')
  })
})

describe('thread session path selection', () => {
  const threadId = '01a0d23c-b953-7362-a3ec-3eb0d334cc1e'
  const older = {
    id: threadId,
    path: `rollout-2026-09-24T15-06-30-${threadId}.jsonl`,
    createdAt: 1790233590,
    updatedAt: 1790592983,
  }
  const newer = {
    id: threadId,
    path: `rollout-2026-09-28T18-57-01-${threadId}_01a0e7a9-354c-76a3-9594-d6b817b90d27.jsonl`,
    createdAt: 1790593021,
    updatedAt: 1790597982,
  }

  it.each([
    [older, newer],
    [newer, older],
  ])('selects the newest duplicate regardless of response order', (...rows) => {
    const server = new AppServerProcess()
    server.rememberThreadPaths({ data: rows })

    expect(server.getThreadSessionPath(threadId)).toBe(newer.path)
  })

  it('does not let an older page overwrite a newer cached path', () => {
    const server = new AppServerProcess()
    server.rememberThreadPaths({ data: [newer] })
    server.rememberThreadPaths({ data: [older] })

    expect(server.getThreadSessionPath(threadId)).toBe(newer.path)
  })

  it('falls back to createdAt and keeps the first path when timestamps are absent', () => {
    const server = new AppServerProcess()
    server.rememberThreadPaths({ data: [{ id: threadId, path: 'unknown.jsonl' }] })
    server.rememberThreadPaths({ data: [{ id: threadId, path: 'created.jsonl', createdAt: 10 }] })
    server.rememberThreadPaths({ data: [{ id: threadId, path: 'later-unknown.jsonl' }] })

    expect(server.getThreadSessionPath(threadId)).toBe('created.jsonl')
  })
})
