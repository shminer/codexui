import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppServerProcess, fetchConfiguredProviderModelIds, normalizeProviderModelsData, readProviderBackedModelIds } from './codexAppServerBridge'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('provider model discovery payload normalization', () => {
  it('reads OpenAI-compatible model ids from data rows', () => {
    expect(normalizeProviderModelsData({
      data: [
        { id: 'gpt-5.4' },
        { id: 'gpt-5.4-mini' },
      ],
    })).toEqual(['gpt-5.4', 'gpt-5.4-mini'])
  })

  it('reads Codex catalog model slugs from models rows', () => {
    expect(normalizeProviderModelsData({
      models: [
        { slug: 'gpt-5.4' },
        { slug: 'gpt-5.3-codex' },
      ],
    })).toEqual(['gpt-5.4', 'gpt-5.3-codex'])
  })

  it('falls back to models rows when data rows are empty', () => {
    expect(normalizeProviderModelsData({
      data: [],
      models: [
        { slug: 'gpt-5.4' },
        { slug: 'gpt-5.3-codex' },
      ],
    })).toEqual(['gpt-5.4', 'gpt-5.3-codex'])
  })

  it('accepts string rows and common model fields while preserving first-seen order', () => {
    expect(normalizeProviderModelsData({
      models: [
        'gpt-5.5',
        { model: 'gpt-5.4' },
        { id: 'gpt-5.5' },
        { slug: 'gpt-5.3-codex' },
      ],
    })).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex'])
  })

  it('rejects payloads without a supported models array', () => {
    expect(() => normalizeProviderModelsData({ object: 'list' }))
      .toThrow('provider /models payload is missing a data/models array')
  })
})

describe('configured provider models', () => {
  it.each(['responses', 'chat'])('discovers %s models with query params and environment auth', async (wireApi) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'vendor/model' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchConfiguredProviderModelIds({
      base_url: 'https://provider.example/v1/?existing=yes', wire_api: wireApi,
      query_params: { version: '2' }, env_key: 'PROVIDER_KEY',
      http_headers: { 'X-Static': 'explicit' },
      env_http_headers: { 'X-Static': 'STATIC', 'X-Tenant': 'TENANT' },
    }, { PROVIDER_KEY: 'secret', STATIC: 'ignored', TENANT: 'workspace' })).toEqual(['vendor/model'])
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe('https://provider.example/v1/models?existing=yes&version=2')
    const headers = new Headers(options.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret')
    expect(headers.get('X-Static')).toBe('explicit')
    expect(headers.get('X-Tenant')).toBe('workspace')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    [{ http_headers: { Authorization: 'Explicit' }, env_http_headers: { authorization: 'AUTH' }, experimental_bearer_token: 'token' }, 'Explicit'],
    [{ env_http_headers: { Authorization: 'AUTH' }, experimental_bearer_token: 'token' }, 'From env header'],
    [{ experimental_bearer_token: 'token', env_key: 'KEY' }, 'Bearer token'],
    [{ env_key: 'MISSING' }, null],
  ])('preserves configured auth precedence', async (config, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchConfiguredProviderModelIds({ base_url: 'https://provider.example/v1', ...config }, { AUTH: 'From env header', KEY: 'ignored' })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe(expected)
  })

  it('uses the requested thread provider instead of the active runtime provider', async () => {
    const appServer = new AppServerProcess()
    vi.spyOn(appServer, 'rpc').mockResolvedValue({ config: {
      model_provider: 'active',
      model_providers: {
        active: { base_url: 'https://active.example/v1' },
        thread_provider: { base_url: 'https://thread.example/v1', wire_api: 'chat' },
      },
    } })
    vi.spyOn(appServer, 'getProviderEnvironment').mockReturnValue({})
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'thread-model' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await readProviderBackedModelIds(appServer, 'thread-provider')).toEqual({
      data: ['thread-model'], providerId: 'thread_provider', source: 'provider',
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://thread.example/v1/models')
    await expect(readProviderBackedModelIds(appServer, 'missing')).rejects.toThrow('not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    [() => Promise.reject(new DOMException('timeout', 'TimeoutError')), 'timed out'],
    [() => Promise.reject(new Error('secret upstream URL')), 'request failed'],
    [() => Promise.resolve(new Response('secret', { status: 401 })), 'HTTP 401'],
    [() => Promise.resolve(new Response('not json')), 'Invalid provider models response'],
    [() => Promise.resolve(Response.json({ invalid: true })), 'Invalid provider models response'],
  ])('reports discovery errors without returning a successful empty catalog', async (response, message) => {
    vi.stubGlobal('fetch', vi.fn(response))
    await expect(fetchConfiguredProviderModelIds({ base_url: 'https://provider.example/v1' })).rejects.toThrow(message)
  })
})
