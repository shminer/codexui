import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLatestThreadMessages, getNewerThreadMessages, getOlderThreadMessages, getThreadCommandOutputPage, getThreadDetail, getThreadResourceSource } from './codexGateway'
import { MAX_COMMAND_OUTPUT_CHARS } from '../commandOutput'

afterEach(() => vi.unstubAllGlobals())

describe('bounded history APIs', () => {
  it('reads side pages and full sources only from ephemeral history', async () => {
    const urls: URL[] = []
    const full = 'x'.repeat(256 * 1024 + 10)
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = new URL(String(input), 'http://localhost')
      urls.push(url)
      if (url.searchParams.get('view') === 'command-output') return Response.json({ data: { text: 'tail', offset: 0, totalLength: 4, nextOffset: null } })
      if (url.pathname.endsWith('thread-resource-source')) return Response.json({ data: [{ id: 'reply', role: 'assistant', text: full }] })
      return Response.json({ result: { thread: { id: 'side', turns: [{ id: 'turn', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: full }] }] } }, startTurnIndex: 0, historyTruncated: true, activeTurnId: 'live-turn' })
    }))
    const page = await getLatestThreadMessages('side', 20, 'ephemeral')
    expect(page).toMatchObject({ historyTruncated: true, activeTurnId: 'live-turn' })
    expect(page.messages[0]).toMatchObject({ textTruncated: true })
    expect(page.messages[0]?.text.length).toBe(256 * 1024)
    expect((await getThreadResourceSource('side', 'turn', 'reply', 'ephemeral'))[0]?.text).toBe(full)
    await getThreadCommandOutputPage('side', 'turn', 'cmd', 0, MAX_COMMAND_OUTPUT_CHARS, 'ephemeral')
    expect(urls.every((url) => url.searchParams.get('source') === 'ephemeral')).toBe(true)
  })
  it('requests exclusive older/newer boundaries and a latest window', async () => {
    const urls: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      urls.push(new URL(String(input), 'http://localhost'))
      return Response.json({ result: { thread: { turns: [] } }, hasMoreOlder: true, hasMoreNewer: true, startTurnIndex: 10, nextTurnIndex: 100 })
    }))
    await getOlderThreadMessages('thread', 'turn-before')
    const page = await getNewerThreadMessages('thread', 'turn-after')
    await getLatestThreadMessages('thread')
    expect(urls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { threadId: 'thread', beforeTurnId: 'turn-before', limit: '10' },
      { threadId: 'thread', afterTurnId: 'turn-after', limit: '10' },
      { threadId: 'thread', limit: '20' },
    ])
    expect(page).toMatchObject({ hasMoreOlder: true, hasMoreNewer: true, nextTurnIndex: 100, startTurnIndex: 10 })
  })

  it('preserves stale-window errors instead of treating them as end of history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'stale_window' }, { status: 409 })))
    await expect(getOlderThreadMessages('thread', 'removed')).rejects.toMatchObject({ status: 409, message: 'stale_window' })
  })

  it('bounds normal history while retaining full output for explicit source reads', async () => {
    const output = 'x'.repeat(MAX_COMMAND_OUTPUT_CHARS + 10)
    vi.stubGlobal('fetch', vi.fn(async (input) => String(input).includes('thread-resource-source')
      ? Response.json({ data: [{ id: 'command', role: 'system', text: 'cmd', commandExecution: { command: 'cmd', cwd: null, status: 'completed', aggregatedOutput: output, exitCode: 0 } }] })
      : Response.json({ result: { thread: { id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [{ id: 'command', type: 'commandExecution', command: 'cmd', aggregatedOutput: output }] }] } } })))
    const history = await getThreadDetail('thread')
    expect(history.messages[0]?.commandExecution).toMatchObject({ outputTruncated: true, outputOffset: 10, outputTotalLength: output.length })
    expect(history.messages[0]?.commandExecution?.aggregatedOutput.length).toBe(MAX_COMMAND_OUTPUT_CHARS)
    expect((await getThreadResourceSource('thread', 'turn', 'command'))[0]?.commandExecution?.aggregatedOutput).toBe(output)
  })

  it('loads one output page without using the array projection parser', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL) => Response.json({ data: { text: 'tail', offset: 100, totalLength: 104, nextOffset: null } }))
    vi.stubGlobal('fetch', request)
    expect(await getThreadCommandOutputPage('thread', 'turn', 'command')).toEqual({ text: 'tail', offset: 100, totalLength: 104, nextOffset: null })
    const url = new URL(String(request.mock.calls[0]?.[0]), 'http://localhost')
    expect(url.searchParams.get('view')).toBe('command-output')
    expect(url.searchParams.has('offset')).toBe(false)
    expect(url.searchParams.get('limit')).toBe(String(MAX_COMMAND_OUTPUT_CHARS))
  })

  it('rejects oversized or invalid output pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { text: 'x'.repeat(MAX_COMMAND_OUTPUT_CHARS + 1), offset: 0, totalLength: MAX_COMMAND_OUTPUT_CHARS + 1, nextOffset: null } })))
    await expect(getThreadCommandOutputPage('thread', 'turn', 'command')).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
