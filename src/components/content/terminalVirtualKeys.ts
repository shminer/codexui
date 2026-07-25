export type TerminalVirtualKey =
  | 'tab'
  | 'escape'
  | 'pageUp'
  | 'pageDown'
  | 'arrowUp'
  | 'arrowDown'
  | 'arrowRight'
  | 'arrowLeft'

const terminalKeyInput: Record<TerminalVirtualKey, string> = {
  tab: '\t',
  escape: '\u001b',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  arrowUp: '\u001b[A',
  arrowDown: '\u001b[B',
  arrowRight: '\u001b[C',
  arrowLeft: '\u001b[D',
}

const ctrlTerminalKeyInput: Partial<Record<TerminalVirtualKey, string>> = {
  pageUp: '\u001b[5;5~',
  pageDown: '\u001b[6;5~',
  arrowUp: '\u001b[1;5A',
  arrowDown: '\u001b[1;5B',
  arrowRight: '\u001b[1;5C',
  arrowLeft: '\u001b[1;5D',
}

const terminalVirtualKeyForKeyboardInput = new Map<string, TerminalVirtualKey>([
  ['\t', 'tab'],
  ['\u001b', 'escape'],
  ['\u001b[5~', 'pageUp'],
  ['\u001b[6~', 'pageDown'],
  ['\u001b[A', 'arrowUp'],
  ['\u001b[B', 'arrowDown'],
  ['\u001b[C', 'arrowRight'],
  ['\u001b[D', 'arrowLeft'],
])

export function terminalVirtualKeyInput(key: TerminalVirtualKey, withCtrl: boolean): string {
  return withCtrl ? (ctrlTerminalKeyInput[key] ?? terminalKeyInput[key]) : terminalKeyInput[key]
}

export function terminalCtrlKeyboardInput(input: string): string | null {
  const virtualKey = terminalVirtualKeyForKeyboardInput.get(input)
  if (virtualKey) return terminalVirtualKeyInput(virtualKey, true)
  if (input === '?') return '\u007f'
  if (input.length !== 1) return null
  const code = input.toUpperCase().charCodeAt(0)
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : null
}
