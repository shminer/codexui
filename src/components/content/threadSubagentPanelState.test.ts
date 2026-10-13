import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../../types/codex'
import {
  DEFAULT_DESKTOP_PANEL_WIDTH,
  canExpandDesktopPanel,
  canShowBothDesktopSidebars,
  DESKTOP_PANEL_COLLAPSED_WIDTH,
  desktopPanelWidthAfterDrag,
  effectiveDesktopPanelWidth,
  isActiveSubagentStatus,
  maximumDesktopPanelWidth,
  mergeCurrentSubagentMessages,
  readStoredDesktopPanelWidth,
} from './threadSubagentPanelState'

describe('desktop subagent sidebar width', () => {
  it('reserves both sidebars and the conversation, including the left separator', () => {
    expect(canShowBothDesktopSidebars(768)).toBe(false)
    expect(canShowBothDesktopSidebars(872)).toBe(false)
    expect(canShowBothDesktopSidebars(873)).toBe(true)
    expect(canShowBothDesktopSidebars(1440)).toBe(true)
  })
  it('grows when dragged left, shrinks when dragged right, and preserves parent space', () => {
    expect(desktopPanelWidthAfterDrag(480, 500, 400, 1440)).toBe(580)
    expect(desktopPanelWidthAfterDrag(480, 500, 600, 1440)).toBe(380)
    expect(desktopPanelWidthAfterDrag(480, 500, -500, 763)).toBe(431)
    expect(desktopPanelWidthAfterDrag(480, 500, 1000, 763)).toBe(280)
  })

  it('normalizes persisted widths to stable hard limits', () => {
    expect(readStoredDesktopPanelWidth(null)).toBe(DEFAULT_DESKTOP_PANEL_WIDTH)
    expect(readStoredDesktopPanelWidth('invalid')).toBe(DEFAULT_DESKTOP_PANEL_WIDTH)
    expect(readStoredDesktopPanelWidth('200')).toBe(280)
    expect(readStoredDesktopPanelWidth('720')).toBe(720)
    expect(readStoredDesktopPanelWidth('1200')).toBe(960)
  })

  it('reports the effective width and maximum for the current parent layout', () => {
    expect(maximumDesktopPanelWidth(763)).toBe(431)
    expect(effectiveDesktopPanelWidth(960, 763)).toBe(431)
    expect(effectiveDesktopPanelWidth(480, 1440)).toBe(480)
  })

  it('only expands when the workspace leaves the minimum conversation width', () => {
    expect(canExpandDesktopPanel(611)).toBe(false)
    expect(canExpandDesktopPanel(612)).toBe(true)
    expect(effectiveDesktopPanelWidth(960, 612)).toBe(280)
    expect(DESKTOP_PANEL_COLLAPSED_WIDTH).toBe(0)
    expect(332 - DESKTOP_PANEL_COLLAPSED_WIDTH).toBe(332)
    expect(canExpandDesktopPanel(376)).toBe(false)
    expect(effectiveDesktopPanelWidth(960, 1440)).toBe(960)
  })
})

describe('subagent activity visibility', () => {
  it('keeps in-progress statuses and hides terminal statuses', () => {
    expect(isActiveSubagentStatus('pendingInit')).toBe(true)
    expect(isActiveSubagentStatus('running')).toBe(true)
    expect(isActiveSubagentStatus(undefined)).toBe(false)
    expect(isActiveSubagentStatus('queued')).toBe(false)
    expect(isActiveSubagentStatus('completed')).toBe(false)
    expect(isActiveSubagentStatus('shutdown')).toBe(false)
    expect(isActiveSubagentStatus('errored')).toBe(false)
    expect(isActiveSubagentStatus('failed')).toBe(false)
    expect(isActiveSubagentStatus('notFound')).toBe(false)
  })
})

describe('current subagent message merging', () => {
  const reply = (id: string, text: string): UiMessage => ({ id, role: 'assistant', text, turnId: 'turn' })
  const command = (output: string, options: Partial<NonNullable<UiMessage['commandExecution']>> = {}): UiMessage => ({
    id: 'command', role: 'system', text: 'echo result', turnId: 'turn', messageType: 'commandExecution',
    commandExecution: { command: 'echo result', cwd: null, status: 'inProgress', aggregatedOutput: output, exitCode: null, ...options },
  })

  it('retains snapshot order and deduplicates current-turn updates', () => {
    const merged = mergeCurrentSubagentMessages(
      [reply('question', 'Question'), reply('reply', 'Result'), reply('next', 'Next')],
      [reply('reply', 'Result continues'), reply('new', 'New')],
    )
    expect(merged.map((message) => [message.id, message.text])).toEqual([
      ['question', 'Question'], ['reply', 'Result continues'], ['next', 'Next'], ['new', 'New'],
    ])
  })

  it('keeps a fuller independent snapshot until the current body passes its prefix', () => {
    const snapshot = [reply('reply', 'Result from snapshot')]
    expect(mergeCurrentSubagentMessages(snapshot, [reply('reply', 'Result')])[0]?.text).toBe('Result from snapshot')
    expect(mergeCurrentSubagentMessages(snapshot, [reply('reply', 'Result from snapshot and delta')])[0]?.text).toBe('Result from snapshot and delta')
    expect(mergeCurrentSubagentMessages(snapshot, [reply('reply', 'Replaced live body')])[0]?.text).toBe('Replaced live body')
  })

  it('uses output cursors rather than tail lengths and preserves a completed snapshot', () => {
    const merged = mergeCurrentSubagentMessages(
      [command('final tail', { outputTotalLength: 1000, status: 'completed', exitCode: 0 })],
      [command('longer stale tail', { outputTotalLength: 500 })],
    )
    expect(merged[0]?.commandExecution).toMatchObject({ aggregatedOutput: 'final tail', outputTotalLength: 1000, status: 'completed', exitCode: 0 })
  })

  it('accepts a newer output cursor using offset plus length without reverting a terminal state', () => {
    const merged = mergeCurrentSubagentMessages(
      [command('old', { outputOffset: 100, status: 'failed', exitCode: 1 })],
      [command('new tail', { outputOffset: 200 })],
    )
    expect(merged[0]?.commandExecution).toMatchObject({ aggregatedOutput: 'new tail', outputOffset: 200, status: 'failed', exitCode: 1 })
    expect(mergeCurrentSubagentMessages([command('old')], [command('done', { status: 'completed', exitCode: 0 })])[0]?.commandExecution)
      .toMatchObject({ aggregatedOutput: 'done', status: 'completed', exitCode: 0 })
  })

  it('keeps the fuller output at equal cursors and updates current plan data by ID', () => {
    const snapshotPlan: UiMessage = { ...reply('plan', ''), plan: { steps: [{ step: 'Check', status: 'pending' }] } }
    const currentPlan: UiMessage = { ...snapshotPlan, plan: { steps: [{ step: 'Check', status: 'completed' }] } }
    const merged = mergeCurrentSubagentMessages(
      [command('full tail', { outputTotalLength: 100 }), snapshotPlan],
      [command('tail', { outputTotalLength: 100 }), currentPlan],
    )
    expect(merged[0]?.commandExecution?.aggregatedOutput).toBe('full tail')
    expect(merged[1]?.plan).toEqual(currentPlan.plan)
    expect(merged).toHaveLength(2)
  })
})
