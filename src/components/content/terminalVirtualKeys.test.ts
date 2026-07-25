import { describe, expect, it } from 'vitest'
import { terminalCtrlKeyboardInput, terminalVirtualKeyInput } from './terminalVirtualKeys'

describe('terminalVirtualKeyInput', () => {
  it('encodes unmodified terminal shortcut keys', () => {
    expect(terminalVirtualKeyInput('tab', false)).toBe('\t')
    expect(terminalVirtualKeyInput('escape', false)).toBe('\u001b')
    expect(terminalVirtualKeyInput('pageUp', false)).toBe('\u001b[5~')
    expect(terminalVirtualKeyInput('pageDown', false)).toBe('\u001b[6~')
    expect(terminalVirtualKeyInput('arrowUp', false)).toBe('\u001b[A')
    expect(terminalVirtualKeyInput('arrowDown', false)).toBe('\u001b[B')
    expect(terminalVirtualKeyInput('arrowRight', false)).toBe('\u001b[C')
    expect(terminalVirtualKeyInput('arrowLeft', false)).toBe('\u001b[D')
  })

  it('encodes the next physical keyboard input after virtual Ctrl', () => {
    expect(terminalCtrlKeyboardInput('c')).toBe('\u0003')
    expect(terminalCtrlKeyboardInput('C')).toBe('\u0003')
    expect(terminalCtrlKeyboardInput('\u001b[A')).toBe('\u001b[1;5A')
    expect(terminalCtrlKeyboardInput('pasted text')).toBeNull()
    expect(terminalCtrlKeyboardInput('constructor')).toBeNull()
  })
})
