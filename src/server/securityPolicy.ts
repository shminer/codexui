import { resolveAllowedPath } from '../safe/pathPolicy.js'
import {
  isAllowedRpcMethod as isSafeRpcMethodAllowed,
  isDisabledRoute as isSafeRouteDisabled,
} from '../safe/featureGate.js'
import type { SafeRuntimeConfig } from '../safe/runtimePolicy.js'

export type ServerSecurityPolicy = {
  isRouteDisabled: (method: string, pathname: string) => boolean
  isRpcMethodAllowed: (method: string) => boolean
  resolveLocalPath: (path: string) => Promise<string | null>
  terminalInputEnabled: boolean
  fileEditingEnabled: boolean
  backgroundIntegrationsEnabled: boolean
  allowTailscaleAuthBypass: boolean
}

export const PERMISSIVE_SECURITY_POLICY: ServerSecurityPolicy = {
  isRouteDisabled: () => false,
  isRpcMethodAllowed: () => true,
  resolveLocalPath: async (path) => path,
  terminalInputEnabled: true,
  fileEditingEnabled: true,
  backgroundIntegrationsEnabled: true,
  allowTailscaleAuthBypass: true,
}

export function buildSafeSecurityPolicy(config: SafeRuntimeConfig): ServerSecurityPolicy {
  return {
    isRouteDisabled: isSafeRouteDisabled,
    isRpcMethodAllowed: (method) => config.rawRpcEnabled || isSafeRpcMethodAllowed(method),
    resolveLocalPath: (path) => resolveAllowedPath(path, config.allowedRoots),
    terminalInputEnabled: config.terminalInputEnabled,
    fileEditingEnabled: config.fileEditingEnabled,
    backgroundIntegrationsEnabled: false,
    allowTailscaleAuthBypass: config.allowTailscaleAuthBypass,
  }
}
