import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('command output detail lifetime', () => {
  it('renders bounded previews and replaces one detail page instead of accumulating pages', async () => {
    const source = await readFile(new URL('./CommandOutput.vue', import.meta.url), 'utf8')
    expect(source).toContain('limitCommandExecutionOutput(props.message.commandExecution)')
    expect(source).toContain('detail.value = page')
    expect(source).not.toContain('detail.value.text +=')
    expect(source).toContain('detail.value = null')
    expect(source).toContain("preview.value?.status !== 'inProgress'")
    expect(source).toContain('props.recoverableHistory !== false')
  })

  it('copies untruncated local data and reads truncated full output only on demand', async () => {
    const source = await readFile(new URL('./CommandOutput.vue', import.meta.url), 'utf8')
    expect(source).toContain("let fullText = props.message.commandExecution?.aggregatedOutput ?? ''")
    expect(source).toContain('if (props.message.commandExecution?.outputTruncated)')
    expect(source).toContain('await getThreadResourceSource(')
    expect(source).toContain("if (!command || command.outputTruncated) throw new Error('Full command output is not available.')")
    expect(source).toContain('if (requestGeneration !== copyGeneration) return')
    expect(source).toContain('if (requestGeneration === copyGeneration) copying.value = false')
  })
})
