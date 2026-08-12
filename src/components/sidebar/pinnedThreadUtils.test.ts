import { describe, expect, it } from 'vitest'
import { updatePinnedThreadIds } from './pinnedThreadUtils'

describe('updatePinnedThreadIds', () => {
  it('pins only the target and preserves pins outside the visible workspace', () => {
    expect(updatePinnedThreadIds(['visible', 'hidden-workspace'], 'new-pin', true)).toEqual([
      'new-pin',
      'visible',
      'hidden-workspace',
    ])
  })

  it('unpins only the target and preserves every other pin', () => {
    expect(updatePinnedThreadIds(['visible', 'hidden-workspace'], 'visible', false)).toEqual([
      'hidden-workspace',
    ])
  })
})
