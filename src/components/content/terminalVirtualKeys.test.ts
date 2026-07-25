import { describe, expect, it } from 'vitest'
import { terminalVirtualKeyInput } from './terminalVirtualKeys'

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

  it('encodes Ctrl-modified navigation keys', () => {
    expect(terminalVirtualKeyInput('c', true)).toBe('\u0003')
    expect(terminalVirtualKeyInput('tab', true)).toBe('\t')
    expect(terminalVirtualKeyInput('escape', true)).toBe('\u001b')
    expect(terminalVirtualKeyInput('arrowUp', true)).toBe('\u001b[1;5A')
    expect(terminalVirtualKeyInput('arrowDown', true)).toBe('\u001b[1;5B')
    expect(terminalVirtualKeyInput('arrowRight', true)).toBe('\u001b[1;5C')
    expect(terminalVirtualKeyInput('arrowLeft', true)).toBe('\u001b[1;5D')
    expect(terminalVirtualKeyInput('pageUp', true)).toBe('\u001b[5;5~')
    expect(terminalVirtualKeyInput('pageDown', true)).toBe('\u001b[6;5~')
  })
})
