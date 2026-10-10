import type { UiMessage } from '../../types/codex'

export const DEFAULT_DESKTOP_PANEL_WIDTH = 480
export const MIN_DESKTOP_PANEL_WIDTH = 280
export const MAX_DESKTOP_PANEL_WIDTH = 960
export const DESKTOP_PANEL_COLLAPSED_WIDTH = 44

const MIN_DESKTOP_THREAD_SPACE = 332
const ACTIVE_SUBAGENT_STATUSES = new Set(['pendingInit', 'running'])

export function canExpandDesktopPanel(layoutWidth: number): boolean {
  return layoutWidth >= MIN_DESKTOP_THREAD_SPACE + MIN_DESKTOP_PANEL_WIDTH
}

export function isActiveSubagentStatus(status: string | undefined): boolean {
  return ACTIVE_SUBAGENT_STATUSES.has(status ?? '')
}

export function mergeCurrentSubagentMessages(snapshot: UiMessage[], current: UiMessage[]): UiMessage[] {
  const messages = new Map(snapshot.map((message) => [message.id, message]))
  for (const message of current) {
    const existing = messages.get(message.id)
    if (!existing) {
      messages.set(message.id, message)
      continue
    }
    let commandExecution = message.commandExecution ?? existing.commandExecution
    if (existing.commandExecution && message.commandExecution) {
      const snapshotCommand = existing.commandExecution
      const currentCommand = message.commandExecution
      const snapshotCursor = snapshotCommand.outputTotalLength
        ?? (snapshotCommand.outputOffset ?? 0) + snapshotCommand.aggregatedOutput.length
      const currentCursor = currentCommand.outputTotalLength
        ?? (currentCommand.outputOffset ?? 0) + currentCommand.aggregatedOutput.length
      const output = currentCursor > snapshotCursor
        || (currentCursor === snapshotCursor && currentCommand.aggregatedOutput.length > snapshotCommand.aggregatedOutput.length)
        ? currentCommand : snapshotCommand
      const terminal = currentCommand.status !== 'inProgress' ? currentCommand
        : snapshotCommand.status !== 'inProgress' ? snapshotCommand : output
      commandExecution = { ...output, status: terminal.status, exitCode: terminal.exitCode }
    }
    messages.set(message.id, {
      ...existing, ...message,
      text: existing.text.startsWith(message.text) ? existing.text : message.text,
      commandExecution,
    })
  }
  return [...messages.values()]
}

export function clampDesktopPanelWidth(value: number, maximum = MAX_DESKTOP_PANEL_WIDTH): number {
  const upperBound = Math.max(MIN_DESKTOP_PANEL_WIDTH, Math.min(MAX_DESKTOP_PANEL_WIDTH, maximum))
  const normalized = Number.isFinite(value) ? Math.round(value) : DEFAULT_DESKTOP_PANEL_WIDTH
  return Math.min(upperBound, Math.max(MIN_DESKTOP_PANEL_WIDTH, normalized))
}

export function maximumDesktopPanelWidth(layoutWidth: number): number {
  return Math.max(
    MIN_DESKTOP_PANEL_WIDTH,
    Math.min(MAX_DESKTOP_PANEL_WIDTH, Math.floor(layoutWidth - MIN_DESKTOP_THREAD_SPACE)),
  )
}

export function effectiveDesktopPanelWidth(preferredWidth: number, layoutWidth: number): number {
  return clampDesktopPanelWidth(preferredWidth, maximumDesktopPanelWidth(layoutWidth))
}

export function desktopPanelWidthAfterDrag(
  startWidth: number,
  startClientX: number,
  clientX: number,
  layoutWidth: number,
): number {
  return clampDesktopPanelWidth(
    startWidth + startClientX - clientX,
    maximumDesktopPanelWidth(layoutWidth),
  )
}

export function readStoredDesktopPanelWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_DESKTOP_PANEL_WIDTH
  return clampDesktopPanelWidth(Number(raw))
}
