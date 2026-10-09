import type { CommandExecutionData, UiMessage } from './types/codex'

export const MAX_COMMAND_OUTPUT_CHARS = 64 * 1024

export function limitCommandExecutionOutput(data: CommandExecutionData): CommandExecutionData {
  const output = data.aggregatedOutput
  const previousOffset = Math.max(0, data.outputOffset ?? 0)
  const totalLength = Math.max(previousOffset + output.length, data.outputTotalLength ?? 0)
  let start = Math.max(0, output.length - MAX_COMMAND_OUTPUT_CHARS)
  // Keep a UTF-16 surrogate pair on the same side of the preview boundary.
  if (start > 0 && /[\uD800-\uDBFF]/u.test(output[start - 1]) && /[\uDC00-\uDFFF]/u.test(output[start])) start += 1
  const truncated = previousOffset + start > 0 || totalLength > previousOffset + output.length
  if (start === 0 && (data.outputOffset ?? 0) === previousOffset
    && (data.outputTotalLength ?? output.length) === totalLength && Boolean(data.outputTruncated) === truncated) return data
  return {
    ...data,
    // Materialize the bounded tail so a sliced string does not retain the full output.
    aggregatedOutput: start > 0 ? output.slice(start).split('').join('') : output,
    outputTruncated: truncated,
    outputOffset: previousOffset + start,
    outputTotalLength: totalLength,
  }
}

export function commandOutputPage(text: string, offset: number | undefined, limit: number) {
  const size = Math.max(1, Math.min(MAX_COMMAND_OUTPUT_CHARS, limit))
  let start = Math.min(text.length, Math.max(0, offset ?? text.length - size))
  const splitsPair = (index: number) => index > 0 && index < text.length
    && /[\uD800-\uDBFF]/u.test(text[index - 1]!) && /[\uDC00-\uDFFF]/u.test(text[index]!)
  if (splitsPair(start)) start += 1
  let end = Math.min(text.length, start + size)
  if (splitsPair(end)) end -= 1
  if (end === start && start < text.length) end = Math.min(text.length, start + 2)
  return { text: text.slice(start, end), offset: start, totalLength: text.length, nextOffset: end < text.length ? end : null }
}

export function limitThreadCommandOutputs(messages: UiMessage[]): UiMessage[] {
  return messages.map((message) => {
    if (!message.commandExecution) return message
    const commandExecution = limitCommandExecutionOutput(message.commandExecution)
    return commandExecution === message.commandExecution ? message : { ...message, commandExecution }
  })
}
