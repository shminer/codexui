import { describe, expect, it } from 'vitest'
import { getSpawnInvocation } from './commandInvocation'

describe('command invocation', () => {
  it('uses the native shell for Windows command shims without rewriting arguments', () => {
    const args = ['app-server', '-c', 'model_providers.opencode_zen.name="OpenCode Zen"']

    expect(getSpawnInvocation('codex', args, 'win32')).toEqual({
      command: 'codex',
      args,
      shell: true,
    })
  })

  it('keeps Linux commands as direct process invocations', () => {
    const args = ['app-server', '-c', 'model_providers.opencode_zen.name="OpenCode Zen"']

    expect(getSpawnInvocation('codex', args, 'linux')).toEqual({ command: 'codex', args })
  })
})
