import { describe, expect, it } from 'vitest'
import { findNextMarkdownLink, parseFileReference, parseMarkdownLinkToken, resolveRelativePath } from './fileReferences'
import { mergeThreadResources, projectMessageResources } from './threadResources'
import { normalizeHistoryEntry, projectHistoryResources, readThreadHistoryEntries } from './server/threadHistoryProjection'
import type { UiMessage } from './types/codex'

describe('thread resource projection', () => {
  it('shares file-link parsing, including nested parentheses and special paths', () => {
    const source = 'See [source](/tmp/my (old)/中文%20 #?.cpp:12) next'
    const token = findNextMarkdownLink(source, 0)!
    const link = parseMarkdownLinkToken(token.token)!
    expect(link.label).toBe('source')
    expect(parseFileReference(link.target)).toEqual({ path: '/tmp/my (old)/中文%20 #?.cpp', line: 12 })
    expect(resolveRelativePath('../src/a.cpp', '/home/user/project/docs')).toBe('/home/user/project/src/a.cpp')
    expect(resolveRelativePath('~/note.md', '/home/user/project')).toBe('/home/user/note.md')
    expect(parseFileReference('https://example.test/source.cpp')).toBeNull()
  })

  it('deduplicates attachments and related files without returning inline image data or message text', () => {
    const messages: UiMessage[] = [
      { id: 'upload', turnId: 'turn-1', role: 'user', text: '', fileAttachments: [{ label: 'Source', path: './src/a.cpp' }], images: ['data:image/png;base64,AAAA', 'blob:temporary'] },
      { id: 'answer', turnId: 'turn-2', role: 'assistant', text: 'Secret text: [source](src/a.cpp:2) and `src/b.cpp`', fileChanges: [{ path: 'src/a.cpp', operation: 'update', diff: '', addedLineCount: 0, removedLineCount: 0 }], images: ['/codex-local-image?path=%2Fproject%2Fimage%20%23.png', 'https://example.test/image.png'] },
    ]
    const resources = projectMessageResources(messages, '/project')
    expect(resources.map((resource) => resource.path || resource.url)).toEqual(['/project/src/a.cpp', '/project/image #.png', 'https://example.test/image.png', '/project/src/b.cpp'])
    expect(resources[0]).toMatchObject({ kind: 'attachment', itemId: 'upload', turnId: 'turn-1' })
    expect(JSON.stringify(resources)).not.toMatch(/Secret text|base64|blob:/u)
    expect(mergeThreadResources(resources, resources)).toEqual(resources)
  })

  it('projects historical saved images and keeps real source IDs without local turn indices', () => {
    const entries = readThreadHistoryEntries([
      { turnId: 'real-turn', item: { type: 'imageGeneration', id: 'generated', savedPath: '/project/output.png', result: 'data:image/png;base64,AAAA' } },
      { turnId: 'real-turn', item: { type: 'agentMessage', id: 'answer', text: '[file](./report.md)' } },
      { turnId: 'real-turn', item: { type: 'imageView', id: 'preview', path: '/tmp/cache.png', savedPath: '/project/original.png' } },
      null,
      { turnId: 'bad', item: {} },
    ])
    expect(entries).toHaveLength(3)
    expect(projectHistoryResources(entries, '/project').map((resource) => resource.path)).toEqual(['/project/output.png', '/project/report.md', '/project/original.png'])
    expect(normalizeHistoryEntry(entries[1]!)[0]).toMatchObject({ id: 'answer', turnId: 'real-turn', turnIndex: undefined })
    expect(() => readThreadHistoryEntries({ data: [] })).toThrow('Invalid native item page')
  })
})
