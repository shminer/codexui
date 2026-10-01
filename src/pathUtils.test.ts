import { describe, expect, it } from 'vitest'
import { encodeLocalPathForUrl, getPathLeafName, getPathParent, normalizeFileUrlToPath, normalizePathForComparison, normalizeSkillMarkdownPath } from './pathUtils'

describe('local path URLs', () => {
  it.each([
    ['C:\\work\\notes.md', '/C%3A/work/notes.md'],
    ['C:/work/notes.md', '/C%3A/work/notes.md'],
    ['C:\\', '/C%3A/'],
    ['\\\\?\\C:\\work\\notes.md', '/C%3A/work/notes.md'],
    ['\\\\server\\share\\notes.md', '//server/share/notes.md'],
    ['\\\\?\\UNC\\server\\share\\notes.md', '//server/share/notes.md'],
    ['file://server/share/notes.md', '//server/share/notes.md'],
    ['file:///C:/work/a%20b.md', '/C%3A/work/a%20b.md'],
    ['/home/user/notes.md', '/home/user/notes.md'],
    ['/', '/'],
    ['/tmp/a#b?c%20.md', '/tmp/a%23b%3Fc%2520.md'],
    ['/tmp/a\\b.md', '/tmp/a%5Cb.md'],
    ['/tmp/report.txt ', '/tmp/report.txt%20'],
    ['/tmp/report.txt\t', '/tmp/report.txt%09'],
    ['file:///tmp/report.txt%20', '/tmp/report.txt%20'],
    ['\\\\?\\C:\\work\\report.txt ', '/C%3A/work/report.txt%20'],
    ['//tmp/a\\b.md', '//tmp/a%5Cb.md'],
    ['/tmp/\u6d4b\u8bd5 (1).md', '/tmp/%E6%B5%8B%E8%AF%95%20(1).md'],
  ])('encodes %s without changing its target', (path, expected) => {
    expect(encodeLocalPathForUrl(path)).toBe(expected)
  })

  it.each([
    ['file:///C:/work/a%2520b.md', 'C:/work/a%20b.md'],
    ['file://localhost/home/user/a%23b.md', '/home/user/a#b.md'],
    ['file://server/share/a%20b.md', '\\\\server\\share\\a b.md'],
    ['file:///tmp/a%5Cb.md', '/tmp/a\\b.md'],
    ['file:///tmp/%ZZ', ''],
  ])('decodes file URLs once: %s', (url, expected) => {
    expect(normalizeFileUrlToPath(url)).toBe(expected)
  })
})

describe('path roots', () => {
  it.each([
    ['C:\\project', 'C:\\'], ['C:/project', 'C:/'], ['C:\\', 'C:\\'],
    ['C:\\work\\project', 'C:\\work'],
    ['\\\\server\\share\\project', '\\\\server\\share\\'],
    ['\\\\server\\share', '\\\\server\\share'],
    ['//home/alice', '//home'],
    ['/project', '/'], ['/', '/'], ['/home/user/project', '/home/user'],
  ])('keeps the parent of %s within its root', (path, expected) => {
    expect(getPathParent(path)).toBe(expected)
  })

  it('compares Windows UNC paths without changing Linux case sensitivity', () => {
    expect(normalizePathForComparison('\\\\SERVER\\Share')).toBe(normalizePathForComparison('//server/share'))
    expect(normalizePathForComparison('/home/User')).not.toBe(normalizePathForComparison('/home/user'))
    expect(normalizePathForComparison('//home/User')).not.toBe(normalizePathForComparison('//home/user'))
    expect(getPathParent('//server/share/project', true)).toBe('//server/share/')
  })

  it('preserves literal backslashes in Linux filenames', () => {
    expect(getPathParent('/tmp/a\\b.md')).toBe('/tmp')
    expect(getPathLeafName('/tmp/a\\b.md')).toBe('a\\b.md')
    expect(getPathLeafName('/tmp/a\\')).toBe('a\\')
    expect(getPathLeafName('C:\\tmp\\a.md')).toBe('a.md')
    expect(getPathLeafName('//tmp/a\\b.md')).toBe('a\\b.md')
    expect(getPathLeafName('/tmp/report.txt ')).toBe('report.txt ')
  })
})

describe('skill markdown paths', () => {
  it.each([
    ['C:\\skills\\demo\\SKILL.md', 'C:/skills/demo/SKILL.md'],
    ['C:\\skills\\demo\\', 'C:/skills/demo/SKILL.md'],
    ['\\\\server\\share\\demo\\SKILL.md', '//server/share/demo/SKILL.md'],
    ['/home/user/skills/demo/SKILL.md', '/home/user/skills/demo/SKILL.md'],
    ['/home/user/skills/demo/', '/home/user/skills/demo/SKILL.md'],
    ['', ''],
  ])('normalizes %s without duplicating SKILL.md', (path, expected) => {
    expect(normalizeSkillMarkdownPath(path)).toBe(expected)
  })
})
