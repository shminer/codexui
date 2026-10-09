import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAT_WIDTH_DEFAULT, CHAT_WIDTH_KEY, loadChatWidthPref, normalizeChatWidth, saveChatWidthPref } from './chatWidth'

afterEach(() => vi.unstubAllGlobals())

describe('chat width preference', () => {
  it.each([
    [0, 640], [640, 640], [647, 640], [648, 656], [720, 720],
    [1920, 1920], [10000, 1920], [NaN, 720], [Infinity, 720],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeChatWidth(input)).toBe(expected)
  })

  it.each([
    [null, 720], ['', 720], ['  ', 720], ['invalid', 720],
    ['Infinity', 720], ['-1', 640], ['2000', 1920], ['801', 800],
  ])('loads stored value %s as %s', (value, expected) => {
    const getItem = vi.fn(() => value)
    vi.stubGlobal('window', { localStorage: { getItem } })
    expect(loadChatWidthPref()).toBe(expected)
    expect(getItem).toHaveBeenCalledWith(CHAT_WIDTH_KEY)
  })

  it('persists a normalized value and the restored default', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } })
    saveChatWidthPref(1001)
    expect(values.get(CHAT_WIDTH_KEY)).toBe('1008')
    expect(loadChatWidthPref()).toBe(1008)
    saveChatWidthPref(CHAT_WIDTH_DEFAULT)
    expect(loadChatWidthPref()).toBe(CHAT_WIDTH_DEFAULT)
  })

  it('handles storage access and write failures', () => {
    vi.stubGlobal('window', { get localStorage(): Storage { throw new Error('blocked') } })
    expect(loadChatWidthPref()).toBe(CHAT_WIDTH_DEFAULT)
    expect(() => saveChatWidthPref(800)).not.toThrow()
    vi.stubGlobal('window', { localStorage: {
      getItem: () => { throw new Error('read failed') },
      setItem: () => { throw new Error('quota exceeded') },
    } })
    expect(loadChatWidthPref()).toBe(CHAT_WIDTH_DEFAULT)
    expect(() => saveChatWidthPref(800)).not.toThrow()
  })

  it('uses the default without a browser window', () => {
    vi.stubGlobal('window', undefined)
    expect(loadChatWidthPref()).toBe(CHAT_WIDTH_DEFAULT)
    expect(() => saveChatWidthPref(800)).not.toThrow()
  })
})
