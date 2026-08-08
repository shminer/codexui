const DISABLED_ROUTE_PREFIXES = [
  '/codex-api/composio/',
  '/codex-api/telegram/',
  '/codex-api/free-mode/',
  '/codex-api/openrouter-proxy/',
  '/codex-api/custom-proxy/',
  '/codex-api/zen-proxy/',
  '/codex-api/skills/install',
  '/codex-api/skills/add',
  '/codex-api/skills/sync',
  '/codex-api/skills-hub/search',
  '/codex-api/skills-hub/install',
  '/codex-api/skills-hub/uninstall',
  '/codex-api/skills-sync/',
]

const ALLOWED_RPC_METHODS = new Set([
  'account/rateLimits/read',
  'app/list',
  'collaborationMode/list',
  'config/batchWrite',
  'config/read',
  'generate-thread-title',
  'mcpServerStatus/list',
  'model/list',
  'plugin/list',
  'plugin/read',
  'setDefaultModel',
  'skills/list',
  'thread/archive',
  'thread/fork',
  'thread/inject_items',
  'thread/list',
  'thread/name/set',
  'thread/read',
  'thread/resume',
  'thread/rollback',
  'thread/start',
  'thread/start-turn',
  'thread/unsubscribe',
  'thread/unarchive',
  'turn/interrupt',
  'turn/start',
])

export function isDisabledRoute(_method: string, pathname: string): boolean {
  return DISABLED_ROUTE_PREFIXES.some((prefix) => (
    pathname === prefix.replace(/\/$/u, '') || pathname.startsWith(prefix)
  ))
}

export function isAllowedRpcMethod(method: string): boolean {
  return ALLOWED_RPC_METHODS.has(method)
}
