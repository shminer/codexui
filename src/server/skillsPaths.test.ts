import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSkillsList } from '../api/codexGateway'
import { handleSkillsRoutes } from './skillsRoutes'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readdir: vi.fn().mockRejectedValue(new Error('No local skills in mock')),
  readFile: vi.fn().mockRejectedValue(new Error('No local readme in mock')),
}))

afterEach(() => vi.unstubAllGlobals())

describe('mock skill paths through server and frontend lists', () => {
  it.each([
    ['C:\\Users\\alice\\.codex\\skills\\demo', 'C:/Users/alice/.codex/skills/demo/SKILL.md', '\\'],
    ['\\\\server\\share\\skills\\demo', '//server/share/skills/demo/SKILL.md', '\\'],
    ['/home/user/.codex/skills/demo', '/home/user/.codex/skills/demo/SKILL.md', '/'],
  ])('preserves the root and groups nested skills under %s', async (root, expected, separator) => {
    const data = [{ cwd: root, skills: [
      { name: 'demo', path: `${root}${separator}SKILL.md`, description: '', scope: 'user', enabled: true },
      { name: 'nested', path: `${root}${separator}nested${separator}SKILL.md`, description: '', scope: 'user', enabled: true },
    ], errors: [] }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ result: { data } })))
    const frontend = await getSkillsList([root])
    expect(frontend.map((skill) => skill.path)).toEqual([expected])

    let body = ''
    const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { body = value } } as unknown as ServerResponse
    const handled = await handleSkillsRoutes(
      { method: 'GET' } as IncomingMessage,
      res,
      new URL('http://localhost/codex-api/skills-hub'),
      { appServer: { rpc: vi.fn().mockResolvedValue({ data }) }, readJsonBody: vi.fn() },
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body).installed.map((skill: { path: string }) => skill.path)).toEqual([expected])
  })
})
