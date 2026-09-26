import { createAuthSession } from './authMiddleware'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { buildSafeSecurityPolicy, PERMISSIVE_SECURITY_POLICY } from './securityPolicy'
import { loadSafeRuntimeConfig } from '../safe/runtimePolicy'

describe('server security policy', () => {
  it('preserves upstream behavior with the permissive default', async () => {
    expect(PERMISSIVE_SECURITY_POLICY.isRouteDisabled('POST', '/codex-api/composio/connect')).toBe(false)
    expect(PERMISSIVE_SECURITY_POLICY.isRpcMethodAllowed('command/exec')).toBe(true)
    expect(PERMISSIVE_SECURITY_POLICY.terminalInputEnabled).toBe(true)
    expect(PERMISSIVE_SECURITY_POLICY.fileEditingEnabled).toBe(true)
    expect(PERMISSIVE_SECURITY_POLICY.backgroundIntegrationsEnabled).toBe(true)
    await expect(PERMISSIVE_SECURITY_POLICY.resolveLocalPath('/tmp/example')).resolves.toBe('/tmp/example')
  })

  it('maps safe runtime configuration to restrictive request behavior', async () => {
    const policy = buildSafeSecurityPolicy(loadSafeRuntimeConfig({}))
    expect(policy.isRouteDisabled('POST', '/codex-api/composio/connect')).toBe(true)
    expect(policy.isRpcMethodAllowed('thread/resume')).toBe(true)
    expect(policy.isRpcMethodAllowed('command/exec')).toBe(false)
    expect(policy.terminalInputEnabled).toBe(false)
    expect(policy.fileEditingEnabled).toBe(false)
    expect(policy.backgroundIntegrationsEnabled).toBe(false)
    await expect(policy.resolveLocalPath('/tmp/example')).resolves.toBeNull()
  })

  it('honors explicit safe raw-RPC and terminal/file switches without enabling disabled routes', () => {
    const policy = buildSafeSecurityPolicy(loadSafeRuntimeConfig({
      CODEX_MOBILE_SAFE_RAW_RPC: 'true',
      CODEX_MOBILE_SAFE_TERMINAL_INPUT: 'true',
      CODEX_MOBILE_SAFE_FILE_EDITING: 'true',
    }))
    expect(policy.isRpcMethodAllowed('command/exec')).toBe(true)
    expect(policy.terminalInputEnabled).toBe(true)
    expect(policy.fileEditingEnabled).toBe(true)
    expect(policy.isRouteDisabled('POST', '/codex-api/telegram/config')).toBe(true)
  })
})

describe('Tailscale authentication policy', () => {
  it.each(['100.100.1.2', '::ffff:100.100.1.2', 'fd7a:115c:a1e0::2'])('requires authentication in safe mode for %s', (remoteAddress) => {
    const request = { socket: { remoteAddress }, headers: { host: '100.100.1.3:5900' } } as IncomingMessage
    const safe = buildSafeSecurityPolicy(loadSafeRuntimeConfig({}))
    expect(createAuthSession('test', safe.allowTailscaleAuthBypass).isRequestAuthorized(request)).toBe(false)
    expect(createAuthSession('test', PERMISSIVE_SECURITY_POLICY.allowTailscaleAuthBypass).isRequestAuthorized(request)).toBe(true)
  })
})
