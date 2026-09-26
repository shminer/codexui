import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearThreadGoal, discardSideConversationThreadInBackground, discardSideConversationThreadOnPageHide, forkThread, getAvailableModelIds, getCurrentModelConfig, getThreadDetail, getThreadGoal, listDirectoryComposioConnectors, resumeThread, setThreadGoal, startSideConversation, startThreadTurn } from './codexGateway'

describe('fork through selected response', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('passes the inclusive lastTurnId to native fork while preserving complete-thread forks', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      return Response.json({ result: { thread: { id: 'forked', cwd: '/tmp', turns: [] }, model: 'gpt-5.5' } })
    }))
    expect((await forkThread('source', { lastTurnId: 'selected' })).threadId).toBe('forked')
    await forkThread('source')
    expect(requests).toEqual([
      { method: 'thread/fork', params: { threadId: 'source', persistExtendedHistory: true, lastTurnId: 'selected' } },
      { method: 'thread/fork', params: { threadId: 'source', persistExtendedHistory: true } },
    ])
  })
})

function mockRpcFetch(): { requests: Array<{ method: string, params: Record<string, unknown> }> } {
  const requests: Array<{ method: string, params: Record<string, unknown> }> = []

  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as { method: string, params: Record<string, unknown> }
      : { method: '', params: {} }

    requests.push(body)

    return new Response(JSON.stringify({
      result: {
        turn: {
          id: `turn-${requests.length}`,
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }))

  return { requests }
}

describe('thread goal RPC', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads, edits, updates status, and clears the official thread goal', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> }
      requests.push(request)
      if (request.method === 'thread/goal/clear') return Response.json({ result: { cleared: true } })
      return Response.json({
        result: {
          goal: {
            threadId: 'thread-1',
            objective: request.params.objective ?? 'Ship the goal UI',
            status: request.params.status ?? 'active',
            tokenBudget: 40_000,
            tokensUsed: 12_500,
            timeUsedSeconds: 90,
            createdAt: 1,
            updatedAt: 2,
          },
        },
      })
    }))

    await expect(getThreadGoal('thread-1')).resolves.toMatchObject({ objective: 'Ship the goal UI' })
    await setThreadGoal('thread-1', { objective: 'Edit the goal', status: 'active', tokenBudget: 40_000 })
    await setThreadGoal('thread-1', { tokenBudget: null })
    await setThreadGoal('thread-1', { status: 'paused' })
    await expect(clearThreadGoal('thread-1')).resolves.toBe(true)

    expect(requests).toEqual([
      { method: 'thread/goal/get', params: { threadId: 'thread-1' } },
      {
        method: 'thread/goal/set',
        params: { threadId: 'thread-1', objective: 'Edit the goal', status: 'active', tokenBudget: 40_000 },
      },
      { method: 'thread/goal/set', params: { threadId: 'thread-1', tokenBudget: null } },
      { method: 'thread/goal/set', params: { threadId: 'thread-1', status: 'paused' } },
      { method: 'thread/goal/clear', params: { threadId: 'thread-1' } },
    ])
  })

  it('rejects invalid objectives and malformed goal responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: { goal: { threadId: 'thread-1' } } })))

    await expect(setThreadGoal('thread-1', { objective: ' '.repeat(5) })).rejects.toThrow('between 1 and 4000')
    await expect(setThreadGoal('thread-1', { objective: 'x'.repeat(4001) })).rejects.toThrow('between 1 and 4000')
    await expect(setThreadGoal('thread-1', { tokenBudget: -1 })).rejects.toThrow('non-negative safe integer')
    await expect(getThreadGoal('thread-1')).rejects.toThrow('invalid goal')
  })
})

describe('pinned thread state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('uses and caches the legacy state endpoint when native sections are unavailable', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      requests.push({ url, method, body })
      if (url === '/codex-api/meta/methods') {
        return Response.json({ data: ['thread/list'] })
      }
      if (method === 'GET') {
        return Response.json({ data: { threadIds: [' pinned-a ', 'pinned-a', 'pinned-b'] } })
      }
      return Response.json({ ok: true })
    }))

    const { getPinnedThreadState, setThreadPinned } = await import('./codexGateway')
    await expect(getPinnedThreadState()).resolves.toEqual({ threadIds: ['pinned-a', 'pinned-b'] })
    await setThreadPinned(' pinned-b ', false)

    expect(requests).toEqual([
      { url: '/codex-api/meta/methods', method: 'GET', body: null },
      { url: '/codex-api/thread-pins', method: 'GET', body: null },
      { url: '/codex-api/thread-pins', method: 'PATCH', body: { threadId: 'pinned-b', pinned: false } },
    ])
  })

  it('pins one native thread without replacing concurrent pins', async () => {
    const rpcRequests: Array<{ method: string; params: Record<string, unknown> }> = []
    let methodCatalogRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/codex-api/meta/methods') {
        methodCatalogRequests += 1
        return Response.json({ data: ['thread/list', 'threadSection/list', 'thread/section/move'] })
      }

      const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> }
      rpcRequests.push(request)
      if (request.method === 'thread/list') {
        return Response.json({
          result: request.params.cursor
            ? { data: [{ id: 'pinned-b' }], nextCursor: null }
            : { data: [{ id: 'pinned-a' }], nextCursor: 'page-2' },
        })
      }
      return Response.json({ result: {} })
    }))

    const { getPinnedThreadState, setThreadPinned } = await import('./codexGateway')
    await expect(getPinnedThreadState()).resolves.toEqual({ threadIds: ['pinned-a', 'pinned-b'] })
    await setThreadPinned('new-pin', true)

    expect(methodCatalogRequests).toBe(1)
    expect(rpcRequests.filter((request) => request.method === 'thread/list')).toHaveLength(3)
    expect(rpcRequests.filter((request) => request.method === 'thread/list').at(-1)?.params.limit).toBe(1)
    expect(rpcRequests.filter((request) => request.method === 'thread/section/move')).toEqual([{
      method: 'thread/section/move',
      params: {
        threadId: 'new-pin',
        sectionId: '01984de2-8f74-7c91-a3b2-5c5e937cf318',
        beforeThreadId: 'pinned-a',
      },
    }])
  })

  it('unpins one native thread without listing or moving other pins', async () => {
    const rpcRequests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/codex-api/meta/methods') {
        return Response.json({ data: ['thread/list', 'threadSection/list', 'thread/section/move'] })
      }
      const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> }
      rpcRequests.push(request)
      return Response.json({ result: {} })
    }))

    const { setThreadPinned } = await import('./codexGateway')
    await setThreadPinned('pinned-a', false)

    expect(rpcRequests).toEqual([{
      method: 'thread/section/move',
      params: {
        threadId: 'pinned-a',
        sectionId: null,
        beforeThreadId: null,
      },
    }])
  })

  it('retries native capability detection after a temporary catalog failure', async () => {
    let methodCatalogRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/codex-api/meta/methods') {
        methodCatalogRequests += 1
        if (methodCatalogRequests === 1) return Response.json({ error: 'temporary failure' }, { status: 503 })
        return Response.json({ data: ['thread/list', 'threadSection/list', 'thread/section/move'] })
      }
      const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> }
      if (request.method === 'thread/list') {
        return Response.json({ result: { data: [{ id: 'native-pin' }], nextCursor: null } })
      }
      return Response.json({ result: {} })
    }))

    const { getPinnedThreadState } = await import('./codexGateway')
    await expect(getPinnedThreadState()).rejects.toThrow('temporary failure')
    await expect(getPinnedThreadState()).resolves.toEqual({ threadIds: ['native-pin'] })
    expect(methodCatalogRequests).toBe(2)
  })

  it('surfaces legacy pin write failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/codex-api/meta/methods') return Response.json({ data: [] })
      return Response.json({ error: 'pin write failed' }, { status: 500 })
    }))

    const { setThreadPinned } = await import('./codexGateway')
    await expect(setThreadPinned('pinned-a', true)).rejects.toThrow('pin write failed')
  })
})

describe('startThreadTurn collaboration mode payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends default collaboration mode explicitly after a plan turn', async () => {
    const { requests } = mockRpcFetch()

    await startThreadTurn('thread-1', 'make a plan', [], 'gpt-5.4', 'medium', undefined, [], 'plan')
    await startThreadTurn('thread-1', 'implement it', [], 'gpt-5.4', 'medium', undefined, [], 'default')

    expect(requests).toHaveLength(2)
    expect(requests[0].method).toBe('turn/start')
    expect(requests[0].params.collaborationMode).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
    expect(requests[1].method).toBe('turn/start')
    expect(requests[1].params.collaborationMode).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
  })
})

describe('side conversation lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forks a protocol-compatible side thread, injects the boundary, and discards it', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string, params: Record<string, unknown> }
      requests.push(request)
      const result = request.method === 'config/read'
        ? {
            config: {
              model: 'gpt-5.4',
              model_provider: 'codex',
              model_reasoning_effort: 'high',
              developer_instructions: 'Parent instructions.',
            },
          }
        : request.method === 'thread/fork'
          ? { thread: { id: 'side-thread-1' } }
          : {}
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const createdThreadIds: string[] = []
    await expect(startSideConversation('parent-thread-1', 'gpt-5.4', 'high', 'opencode_zen', (threadId) => {
      createdThreadIds.push(threadId)
    })).resolves.toEqual({
      threadId: 'side-thread-1',
    })
    await discardSideConversationThreadInBackground('side-thread-1', 'turn-1')

    expect(createdThreadIds).toEqual(['side-thread-1'])
    expect(requests.map((request) => request.method)).toEqual([
      'config/read',
      'thread/fork',
      'thread/inject_items',
      'turn/interrupt',
      'thread/unsubscribe',
    ])
    expect(requests[1].params).toMatchObject({
      threadId: 'parent-thread-1',
      model: 'gpt-5.4',
      modelProvider: 'opencode_zen',
      config: { model_reasoning_effort: 'high' },
      ephemeral: true,
      excludeTurns: true,
    })
    expect(requests[1].params).not.toHaveProperty('persistExtendedHistory')
    expect(requests[1].params).not.toHaveProperty('sideConversation')
    expect(requests[1].params.developerInstructions).toContain('Parent instructions.')
    expect(requests[1].params.developerInstructions).toContain('You are in a side conversation')
    expect(requests[2].params).toMatchObject({
      threadId: 'side-thread-1',
      items: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text' }],
      }],
    })
  })

  it('still unsubscribes during background cleanup when interrupt fails', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string, params: Record<string, unknown> }
      requests.push(request)
      return new Response(JSON.stringify(request.method === 'turn/interrupt'
        ? { error: 'interrupt failed' }
        : { result: {} }), {
        status: request.method === 'turn/interrupt' ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await discardSideConversationThreadInBackground('side-thread-background', 'turn-2')

    expect(requests.map((request) => request.method)).toEqual([
      'turn/interrupt',
      'thread/unsubscribe',
    ])
  })

  it('unsubscribes an idle side thread without an empty background interrupt', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { method: string, params: Record<string, unknown> })
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await discardSideConversationThreadInBackground('side-thread-idle')

    expect(requests).toEqual([
      { method: 'thread/unsubscribe', params: { threadId: 'side-thread-idle' } },
    ])
  })

  it('retries a background interrupt with the active turn id from a mismatch', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string, params: Record<string, unknown> }
      requests.push(request)
      const isFirstInterrupt = request.method === 'turn/interrupt' && requests.length === 1
      return new Response(JSON.stringify(isFirstInterrupt
        ? { error: 'expected active turn id `stale-turn` but found `actual-turn`' }
        : { result: {} }), {
        status: isFirstInterrupt ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await discardSideConversationThreadInBackground('side-thread-race', 'stale-turn')

    expect(requests).toEqual([
      {
        method: 'turn/interrupt',
        params: { threadId: 'side-thread-race', turnId: 'stale-turn' },
      },
      {
        method: 'turn/interrupt',
        params: { threadId: 'side-thread-race', turnId: 'actual-turn' },
      },
      {
        method: 'thread/unsubscribe',
        params: { threadId: 'side-thread-race' },
      },
    ])
  })

  it('uses keepalive cleanup when the page is hidden', () => {
    const requests: Array<{ url: string, body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      expect(init?.keepalive).toBe(true)
      return Response.json({ result: {} })
    }))

    discardSideConversationThreadOnPageHide('side-thread-pagehide')

    expect(requests).toEqual([
      {
        url: '/codex-api/side-conversation/discard',
        body: { threadId: 'side-thread-pagehide' },
      },
    ])
  })
})

describe('listDirectoryComposioConnectors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends search queries as query params expected by the server', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        data: [],
        nextCursor: null,
        total: 0,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }))

    await listDirectoryComposioConnectors('instagram', '50', 25)

    expect(requests).toEqual(['/codex-api/composio/connectors?query=instagram&cursor=50&limit=25'])
  })
})

describe('getAvailableModelIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses provider models without waiting for model/list when provider models are required', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      if (String(input) === '/codex-api/provider-models') {
        return new Response(JSON.stringify({
          data: ['big-pickle', 'deepseek-v4-flash-free'],
          exclusive: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected request ${String(input)}`)
    }))

    await expect(getAvailableModelIds({
      includeProviderModels: true,
      requireProviderModels: true,
    })).resolves.toEqual(['big-pickle', 'deepseek-v4-flash-free'])
    expect(requests).toEqual(['/codex-api/provider-models'])
  })

  it('requests models for an explicit thread provider', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      if (String(input) === '/codex-api/provider-models?provider=opencode-zen') {
        return new Response(JSON.stringify({
          data: ['big-pickle', 'ring-2.6-1t-free'],
          exclusive: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected request ${String(input)}`)
    }))

    await expect(getAvailableModelIds({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    })).resolves.toEqual(['big-pickle', 'ring-2.6-1t-free'])
    expect(requests).toEqual(['/codex-api/provider-models?provider=opencode-zen'])
  })

  it('falls back to model/list when provider models are optional and unavailable', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(input))
      if (String(input) === '/codex-api/provider-models') {
        return new Response(JSON.stringify({ data: [] }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string }
        : { method: '' }
      expect(body.method).toBe('model/list')
      return new Response(JSON.stringify({
        result: {
          data: [
            { id: 'gpt-5.5' },
            { model: 'gpt-5.4-mini' },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await expect(getAvailableModelIds({
      includeProviderModels: true,
    })).resolves.toEqual(['gpt-5.5', 'gpt-5.4-mini'])
    expect(requests).toEqual(['/codex-api/provider-models', '/codex-api/rpc'])
  })

  it('loads every visible model-list page without provider models', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string, params: Record<string, unknown> }
      requests.push(body)
      const cursor = body.params.cursor
      return new Response(JSON.stringify({
        result: cursor
          ? { data: [{ id: 'gpt-5.6-sol' }], nextCursor: null }
          : { data: [{ id: 'gpt-5.6' }, { id: 'gpt-5.6-sol' }], nextCursor: 'next-page' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await expect(getAvailableModelIds({ includeProviderModels: false })).resolves.toEqual([
      'gpt-5.6',
      'gpt-5.6-sol',
    ])
    expect(requests).toEqual([
      { method: 'model/list', params: {} },
      { method: 'model/list', params: { cursor: 'next-page' } },
    ])
  })

  it('reports Max and Ultra capabilities from model/list', async () => {
    let catalog: unknown = null
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: {
        data: [{
          id: 'gpt-5.6',
          supportedReasoningEfforts: [
            { reasoningEffort: 'xhigh', description: 'Extra high' },
            { reasoningEffort: 'max', description: 'Max' },
            { reasoningEffort: 'ultra', description: 'Ultra' },
          ],
        }],
        nextCursor: null,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await getAvailableModelIds({
      includeProviderModels: false,
      onModelCatalog: (models: unknown) => {
        catalog = models
      },
    } as never)

    expect(catalog).toEqual([{
      id: 'gpt-5.6',
      supportedReasoningEfforts: ['xhigh', 'max', 'ultra'],
    }])
  })
})

describe('getCurrentModelConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks providers requiring OpenAI auth as upstream catalog providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: {
        config: {
          model: 'gpt-5.6-sol',
          model_provider: 'codex_local_access',
          model_providers: {
            codex_local_access: { requires_openai_auth: true },
            custom: { requires_openai_auth: false },
          },
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(getCurrentModelConfig()).resolves.toEqual({
      model: 'gpt-5.6-sol',
      providerId: 'codex_local_access',
      upstreamCatalogProviderIds: ['codex_local_access'],
      reasoningEffort: '',
      speedMode: 'standard',
    })
  })

  it.each(['max', 'ultra'])('preserves the %s reasoning effort returned by config/read', async (reasoningEffort) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: {
        config: {
          model: 'gpt-5.6',
          model_reasoning_effort: reasoningEffort,
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(getCurrentModelConfig()).resolves.toMatchObject({
      model: 'gpt-5.6',
      reasoningEffort,
    })
  })
})

describe('getThreadDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns direct subagents in first-spawn order with their latest status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: {
        thread: {
          id: 'parent-thread',
          turns: [{
            id: 'turn-1',
            items: [
              {
                id: 'spawn-1',
                type: 'collabAgentToolCall',
                tool: 'spawnAgent',
                senderThreadId: 'parent-thread',
                prompt: 'Inspect the gateway',
                receiverThreadIds: ['agent-a'],
                agentsStates: {
                  'agent-a': { status: 'running', message: 'Reading files' },
                },
              },
              {
                id: 'spawn-2',
                type: 'collabAgentToolCall',
                tool: 'spawnAgent',
                senderThreadId: 'parent-thread',
                prompt: 'Check permissions',
                receiverThreadIds: ['agent-b'],
                agentsStates: {
                  'agent-b': { status: 'running', message: 'Checking access' },
                },
              },
              {
                id: 'wait-1',
                type: 'collabAgentToolCall',
                tool: 'wait',
                senderThreadId: 'parent-thread',
                prompt: 'Ignore this later prompt',
                receiverThreadIds: ['agent-a', 'agent-b', 'agent-orphan'],
                agentsStates: {
                  'agent-a': { status: 'completed', message: 'Gateway checked' },
                  'agent-b': { status: 'failed', message: 'No permission' },
                  'agent-orphan': { status: 'running', message: 'Do not show without spawn' },
                },
              },
              {
                id: 'nested-spawn',
                type: 'collabAgentToolCall',
                tool: 'spawnAgent',
                senderThreadId: 'agent-a',
                prompt: 'Do not show this grandchild',
                receiverThreadIds: ['agent-child'],
                agentsStates: {
                  'agent-child': { status: 'running', message: 'Nested work' },
                },
              },
            ],
          }],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const detail = await getThreadDetail('parent-thread')

    expect(detail.subagents).toEqual([
      {
        threadId: 'agent-a',
        prompt: 'Inspect the gateway',
        status: 'completed',
        message: 'Gateway checked',
      },
      {
        threadId: 'agent-b',
        prompt: 'Check permissions',
        status: 'failed',
        message: 'No permission',
      },
    ])
  })

  it('returns direct subagents from current subAgentActivity payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: {
        thread: {
          id: 'parent-thread',
          turns: [{
            id: 'turn-1',
            items: [
              {
                id: 'activity-1',
                type: 'subAgentActivity',
                kind: 'started',
                agentThreadId: 'agent-a',
                agentPath: '/root/agent-a',
              },
              {
                id: 'activity-2',
                type: 'subAgentActivity',
                kind: 'interacted',
                agentThreadId: 'agent-a',
                agentPath: '/root/agent-a',
              },
              {
                id: 'activity-3',
                type: 'subAgentActivity',
                kind: 'interacted',
                agentThreadId: 'agent-b',
                agentPath: '/root/agent-b',
              },
              {
                id: 'spawn-1',
                type: 'collabAgentToolCall',
                tool: 'spawnAgent',
                senderThreadId: 'parent-thread',
                prompt: 'Inspect the gateway',
                receiverThreadIds: ['agent-b'],
                agentsStates: {
                  'agent-b': { status: 'completed', message: 'Gateway checked' },
                },
              },
              {
                id: 'activity-4',
                type: 'subAgentActivity',
                kind: 'interacted',
                agentThreadId: 'agent-b',
                agentPath: '/root/agent-b',
              },
              {
                id: 'activity-5',
                type: 'subAgentActivity',
                kind: 'interrupted',
                agentThreadId: 'agent-a',
                agentPath: '/root/agent-a',
              },
              {
                id: 'activity-6',
                type: 'subAgentActivity',
                kind: 'interacted',
                agentThreadId: 'agent-c',
                agentPath: '/root/agent-c',
              },
              {
                id: 'activity-7',
                type: 'subAgentActivity',
                kind: 'future-kind',
                agentThreadId: 'agent-d',
                agentPath: '',
              },
              {
                id: 'activity-8',
                type: 'subAgentActivity',
                kind: 'started',
                agentThreadId: '',
                agentPath: '/root/ignored',
              },
            ],
          }],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const detail = await getThreadDetail('parent-thread')

    expect(detail.subagents).toEqual([
      {
        threadId: 'agent-a',
        prompt: '',
        status: 'shutdown',
        message: '/root/agent-a',
      },
      {
        threadId: 'agent-b',
        prompt: 'Inspect the gateway',
        status: 'completed',
        message: 'Gateway checked',
      },
      {
        threadId: 'agent-c',
        prompt: '',
        status: 'pendingInit',
        message: '/root/agent-c',
      },
      {
        threadId: 'agent-d',
        prompt: '',
        status: 'pendingInit',
        message: '',
      },
    ])
  })

  it('reads modelProvider from nested thread payloads returned by thread/read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string; params: Record<string, unknown> }
        : { method: '', params: {} }
      expect(body.method).toBe('thread/read')
      return new Response(JSON.stringify({
        result: {
          thread: {
            id: body.params.threadId,
            modelProvider: 'opencode_zen',
            turns: [],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await expect(getThreadDetail('legacy-thread')).resolves.toMatchObject({
      modelProvider: 'opencode_zen',
    })
  })
})

describe('resumeThread', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces repeated resume failures for the same thread', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string; params: Record<string, unknown> }
        : { method: '', params: {} }
      requests.push(body)
      return new Response(JSON.stringify({ error: 'no rollout found for thread id missing-thread' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const results = await Promise.allSettled([
      resumeThread('missing-thread'),
      resumeThread('missing-thread'),
    ])

    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(requests).toEqual([
      { method: 'thread/resume', params: { threadId: 'missing-thread' } },
    ])
  })

  it('evicts a stalled resume so later resume attempts are not pinned forever', async () => {
    vi.useFakeTimers()
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string; params: Record<string, unknown> }
        : { method: '', params: {} }
      requests.push(body)
      return new Promise<Response>(() => undefined)
    }))

    const first = resumeThread('stalled-thread')
    void resumeThread('stalled-thread')
    expect(requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)

    const retried = resumeThread('stalled-thread')
    expect(retried).not.toBe(first)
    expect(requests).toEqual([
      { method: 'thread/resume', params: { threadId: 'stalled-thread' } },
      { method: 'thread/resume', params: { threadId: 'stalled-thread' } },
    ])
  })
})
