import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAvailableModelIds, getCurrentModelConfig, getThreadDetail, listDirectoryComposioConnectors, resumeThread, startThreadTurn } from './codexGateway'

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
