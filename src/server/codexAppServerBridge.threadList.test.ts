import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

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
