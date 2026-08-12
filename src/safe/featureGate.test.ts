import { describe, expect, it } from 'vitest'
import { isAllowedRpcMethod, isDisabledRoute } from './featureGate'

describe('safe feature gate', () => {
  it('allows the thread RPC methods needed by the mobile client', () => {
    expect(isAllowedRpcMethod('thread/read')).toBe(true)
    expect(isAllowedRpcMethod('thread/resume')).toBe(true)
    expect(isAllowedRpcMethod('thread/inject_items')).toBe(true)
    expect(isAllowedRpcMethod('thread/unsubscribe')).toBe(true)
    expect(isAllowedRpcMethod('thread/section/move')).toBe(true)
    expect(isAllowedRpcMethod('threadSection/list')).toBe(true)
    expect(isAllowedRpcMethod('turn/start')).toBe(true)
  })

  it('rejects raw or integration RPC methods outside the allowlist', () => {
    expect(isAllowedRpcMethod('command/exec')).toBe(false)
    expect(isAllowedRpcMethod('composio/connect')).toBe(false)
  })

  it('blocks risky integration and mutation route prefixes', () => {
    expect(isDisabledRoute('POST', '/codex-api/composio/connect')).toBe(true)
    expect(isDisabledRoute('POST', '/codex-api/telegram/config')).toBe(true)
    expect(isDisabledRoute('POST', '/codex-api/skills/install')).toBe(true)
    expect(isDisabledRoute('GET', '/codex-api/thread-turns')).toBe(false)
  })
})
