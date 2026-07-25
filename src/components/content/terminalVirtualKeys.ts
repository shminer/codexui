export type TerminalVirtualKey =
  | 'c'
  | 'tab'
  | 'escape'
  | 'pageUp'
  | 'pageDown'
  | 'arrowUp'
  | 'arrowDown'
  | 'arrowRight'
  | 'arrowLeft'

const terminalKeyInput: Record<TerminalVirtualKey, string> = {
  c: 'c',
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
  c: '\u0003',
  pageUp: '\u001b[5;5~',
  pageDown: '\u001b[6;5~',
  arrowUp: '\u001b[1;5A',
  arrowDown: '\u001b[1;5B',
  arrowRight: '\u001b[1;5C',
  arrowLeft: '\u001b[1;5D',
}

export function terminalVirtualKeyInput(key: TerminalVirtualKey, withCtrl: boolean): string {
  return withCtrl ? (ctrlTerminalKeyInput[key] ?? terminalKeyInput[key]) : terminalKeyInput[key]
}
