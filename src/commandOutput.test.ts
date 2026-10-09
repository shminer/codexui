import { describe, expect, it } from 'vitest'
import { commandOutputPage, limitCommandExecutionOutput, MAX_COMMAND_OUTPUT_CHARS } from './commandOutput'
import type { CommandExecutionData } from './types/codex'

const command = (aggregatedOutput: string): CommandExecutionData => ({
  command: 'printf output', cwd: null, status: 'completed', aggregatedOutput, exitCode: 0,
})

describe('command output previews', () => {
  it('reuses an already bounded command', () => {
    const data = command('short output')
    expect(limitCommandExecutionOutput(data)).toBe(data)
  })

  it('retains only the tail and tracks the complete output length', () => {
    const output = 'prefix' + 'x'.repeat(MAX_COMMAND_OUTPUT_CHARS)
    expect(limitCommandExecutionOutput(command(output))).toMatchObject({
      aggregatedOutput: 'x'.repeat(MAX_COMMAND_OUTPUT_CHARS), outputOffset: 6,
      outputTotalLength: output.length, outputTruncated: true,
    })
  })

  it('keeps offsets correct after appending to a previously truncated preview', () => {
    const preview = limitCommandExecutionOutput(command('x'.repeat(MAX_COMMAND_OUTPUT_CHARS + 20)))
    const next = limitCommandExecutionOutput({ ...preview, aggregatedOutput: preview.aggregatedOutput + 'tail' })
    expect(next.outputOffset).toBe(24)
    expect(next.outputTotalLength).toBe(MAX_COMMAND_OUTPUT_CHARS + 24)
    expect(next.aggregatedOutput.endsWith('tail')).toBe(true)
    expect(limitCommandExecutionOutput(next)).toBe(next)
  })

  it('never starts a preview with half a surrogate pair', () => {
    const preview = limitCommandExecutionOutput(command('\uD83D\uDE00' + 'x'.repeat(MAX_COMMAND_OUTPUT_CHARS - 1)))
    expect(preview.aggregatedOutput).toBe('x'.repeat(MAX_COMMAND_OUTPUT_CHARS - 1))
    expect(preview.outputOffset).toBe(2)
  })

  it('preserves isolated UTF-16 code units when materializing a truncated preview', () => {
    const tail = `\uD800${'x'.repeat(MAX_COMMAND_OUTPUT_CHARS - 1)}`
    expect(limitCommandExecutionOutput(command(`prefix${tail}`)).aggregatedOutput).toBe(tail)
  })

  it('paginates local output without splitting surrogate pairs or losing characters', () => {
    const output = `${'x'.repeat(MAX_COMMAND_OUTPUT_CHARS - 1)}\uD83D\uDE00tail`
    const first = commandOutputPage(output, 0, MAX_COMMAND_OUTPUT_CHARS)
    const second = commandOutputPage(output, first.nextOffset!, MAX_COMMAND_OUTPUT_CHARS)
    expect(first.text).toBe('x'.repeat(MAX_COMMAND_OUTPUT_CHARS - 1))
    expect(second.text).toBe('\uD83D\uDE00tail')
    expect(first.text + second.text).toBe(output)
    expect(second.nextOffset).toBeNull()
  })
})
