import { describe, expect, it } from 'vitest'
import { getCodexCommandCandidates } from './commandResolution'

describe('Codex command resolution', () => {
  it('uses the Codex executable exposed through the Windows PATH', () => {
    expect(getCodexCommandCandidates('win32')).toEqual(['codex.exe', 'codex'])
  })
})
