<template>
  <Teleport to="body">
    <section
      class="thread-terminal-panel"
      :class="{ 'is-error': Boolean(errorMessage) }"
      :style="terminalWindowStyle"
    >
      <div class="thread-terminal-drag-handle" @pointerdown.stop="onTerminalHeaderPointerDown" />
      <header class="thread-terminal-header" @pointerdown="onTerminalHeaderPointerDown">
        <div class="thread-terminal-tabs">
          <button
            v-for="(tab, index) in tabs"
            :key="tab.id"
            class="thread-terminal-tab"
            :class="{ 'is-active': tab.id === activeSessionId }"
            type="button"
            :title="terminalTabTitle(tab, index)"
            @click="onSelectTab(tab.id)"
          >
            <span class="thread-terminal-dot" :data-status="tab.status" />
            <span class="thread-terminal-title">{{ terminalTabTitle(tab, index) }}</span>
          </button>
        </div>
        <div class="thread-terminal-actions">
          <button class="thread-terminal-action" type="button" title="New" @click="onNewTerminal">
            New
          </button>
          <button class="thread-terminal-action" type="button" :title="t('Hide terminal')" @click="onHideTerminal">
            {{ t('Hide') }}
          </button>
          <button class="thread-terminal-action" type="button" :title="t('Close')" @click="onCloseTerminal">
            {{ t('Close') }}
          </button>
        </div>
      </header>
      <p v-if="errorMessage" class="thread-terminal-error">{{ errorMessage }}</p>
      <div
        ref="terminalHostRef"
        class="thread-terminal-host"
        @pointerdown="emit('terminalFocusChange', true)"
        @focusin="emit('terminalFocusChange', true)"
        @focusout="onTerminalFocusOut"
      />
      <div class="thread-terminal-shortcuts" aria-label="Terminal shortcuts">
        <button class="thread-terminal-shortcut" type="button" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('tab')">
          Tab
        </button>
        <button
          class="thread-terminal-shortcut"
          type="button"
          :disabled="isTerminalInputUnavailable"
          :aria-pressed="ctrlShortcutArmed"
          @pointerdown.prevent
          @click="toggleCtrlShortcut"
        >
          Ctrl
        </button>
        <button class="thread-terminal-shortcut" type="button" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('escape')">
          Esc
        </button>
        <button class="thread-terminal-shortcut" type="button" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('pageUp')">
          PgUp
        </button>
        <button class="thread-terminal-shortcut" type="button" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('pageDown')">
          PgDn
        </button>
        <button class="thread-terminal-shortcut thread-terminal-shortcut-icon" type="button" aria-label="Arrow left" title="Arrow left" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('arrowLeft')">
          <IconTablerArrowUp class="thread-terminal-shortcut-arrow thread-terminal-shortcut-arrow-left" />
        </button>
        <button class="thread-terminal-shortcut thread-terminal-shortcut-icon" type="button" aria-label="Arrow up" title="Arrow up" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('arrowUp')">
          <IconTablerArrowUp class="thread-terminal-shortcut-arrow" />
        </button>
        <button class="thread-terminal-shortcut thread-terminal-shortcut-icon" type="button" aria-label="Arrow down" title="Arrow down" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('arrowDown')">
          <IconTablerArrowUp class="thread-terminal-shortcut-arrow thread-terminal-shortcut-arrow-down" />
        </button>
        <button class="thread-terminal-shortcut thread-terminal-shortcut-icon" type="button" aria-label="Arrow right" title="Arrow right" :disabled="isTerminalInputUnavailable" @pointerdown.prevent @click="onVirtualTerminalKey('arrowRight')">
          <IconTablerArrowUp class="thread-terminal-shortcut-arrow thread-terminal-shortcut-arrow-right" />
        </button>
      </div>
      <div class="thread-terminal-resize-handle" role="separator" aria-label="Resize terminal" @pointerdown="onTerminalResizePointerDown">
        <IconTablerMaximize class="thread-terminal-resize-icon" />
      </div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useUiLanguage } from '../../composables/useUiLanguage'
import {
  attachThreadTerminal,
  closeThreadTerminal,
  getThreadTerminalQuickCommands,
  resizeThreadTerminal,
  sendThreadTerminalInput,
  subscribeCodexNotifications,
  type RpcNotification,
  type ThreadTerminalQuickCommand,
} from '../../api/codexGateway'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerMaximize from '../icons/IconTablerMaximize.vue'
import {
  clampTerminalWindowRect,
  initialTerminalWindowRect,
  type TerminalFloatingWindowRect,
  type TerminalVisualViewport,
} from './terminalFloatingWindow'
import { terminalCtrlKeyboardInput, terminalVirtualKeyInput, type TerminalVirtualKey } from './terminalVirtualKeys'

const props = defineProps<{
  threadId: string
  cwd: string
}>()

type ThreadTerminalPanelExposed = {
  runQuickCommand: (command: string, custom?: boolean) => Promise<void>
}

type TerminalWindowGesture = {
  kind: 'drag' | 'resize'
  pointerId: number
  startClientX: number
  startClientY: number
  startRect: TerminalFloatingWindowRect
  target: HTMLElement
}

const emit = defineEmits<{
  hide: []
  terminalFocusChange: [focused: boolean]
}>()

const terminalHostRef = ref<HTMLElement | null>(null)
const activeSessionId = ref('')
const errorMessage = ref('')
const tabs = ref<TerminalTab[]>([])
const ctrlShortcutArmed = ref(false)
const terminalWindow = ref<TerminalFloatingWindowRect>({ left: 8, top: 8, width: 640, height: 420 })

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let unsubscribeNotifications: (() => void) | null = null
let resizeFrame = 0
let attachPromise: Promise<void> | null = null
let latestAttachRequest = 0
let terminalWindowGesture: TerminalWindowGesture | null = null
let lastResizedTerminalGrid: { sessionId: string, cols: number, rows: number } | null = null
const { t } = useUiLanguage()

type TerminalTab = {
  id: string
  shell: string
  status: 'connecting' | 'attached' | 'exited' | 'error'
}

type QuickCommand = {
  label: string
  value: string
  custom?: boolean
  usageCount: number
  lastUsedAt: number
  sourceIndex?: number
}

const QUICK_COMMAND_STORAGE_KEY = 'codex-web-local.terminal-quick-commands.v1'
const TERMINAL_TABS_STORAGE_KEY = 'codex-web-local.terminal-tabs.v1'
const MAX_VISIBLE_QUICK_COMMANDS = 5

const storedQuickCommands = ref<QuickCommand[]>(loadStoredQuickCommands())
const projectQuickCommands = ref<ThreadTerminalQuickCommand[]>([])

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeSessionId.value) ?? null)
const isTerminalInputUnavailable = computed(() => !activeSessionId.value)
const terminalWindowStyle = computed<Record<string, string>>(() => ({
  left: `${terminalWindow.value.left}px`,
  top: `${terminalWindow.value.top}px`,
  width: `${terminalWindow.value.width}px`,
  height: `${terminalWindow.value.height}px`,
}))
const quickCommands = computed<QuickCommand[]>(() => {
  const storedByValue = new Map(storedQuickCommands.value.map((command) => [command.value, command]))
  const combined = [
    ...projectQuickCommands.value.map((command, index) => ({
      label: command.label,
      value: command.value,
      usageCount: 0,
      lastUsedAt: 0,
      ...(storedByValue.get(command.value) ?? {}),
      custom: false,
      sourceIndex: index,
    })),
    ...storedQuickCommands.value.filter((command) => command.custom === true),
  ]
  return combined
    .sort(compareQuickCommands)
    .slice(0, MAX_VISIBLE_QUICK_COMMANDS)
})

onMounted(() => {
  restoreSavedTabs()
  resetTerminalWindow()
  window.addEventListener('resize', onTerminalViewportResize)
  window.visualViewport?.addEventListener('resize', onTerminalViewportResize)
  window.visualViewport?.addEventListener('scroll', clampTerminalWindowToViewport)
  createTerminal()
  unsubscribeNotifications = subscribeCodexNotifications(handleNotification)
  void refreshProjectQuickCommands()
  void attachToThread(false)
})

onBeforeUnmount(() => {
  if (resizeFrame) {
    window.cancelAnimationFrame(resizeFrame)
    resizeFrame = 0
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  unsubscribeNotifications?.()
  unsubscribeNotifications = null
  stopTerminalWindowGesture()
  window.removeEventListener('resize', onTerminalViewportResize)
  window.visualViewport?.removeEventListener('resize', onTerminalViewportResize)
  window.visualViewport?.removeEventListener('scroll', clampTerminalWindowToViewport)
  terminal?.dispose()
  terminal = null
  fitAddon = null
})

watch(
  () => [props.threadId, props.cwd] as const,
  () => {
    ctrlShortcutArmed.value = false
    restoreSavedTabs()
    void refreshProjectQuickCommands()
    void attachToThread(false)
  },
)

function createTerminal(): void {
  if (!terminalHostRef.value) return
  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.25,
    scrollback: 10000,
    theme: {
      background: '#050505',
      foreground: '#e5e7eb',
      cursor: '#f4f4f5',
      selectionBackground: '#475569',
      black: '#18181b',
      red: '#f87171',
      green: '#86efac',
      yellow: '#fde68a',
      blue: '#93c5fd',
      magenta: '#d8b4fe',
      cyan: '#67e8f9',
      white: '#f4f4f5',
    },
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHostRef.value)
  terminal.onData((data) => {
    const ctrlInput = ctrlShortcutArmed.value ? terminalCtrlKeyboardInput(data) : null
    ctrlShortcutArmed.value = false
    sendTerminalInput(ctrlInput ?? data, t('Terminal input failed'))
  })

  resizeObserver = new ResizeObserver(() => {
    scheduleFitAndResize()
  })
  resizeObserver.observe(terminalHostRef.value)
  scheduleFitAndResize()
}

async function attachToThread(newSession: boolean, targetSessionId = ''): Promise<void> {
  if (attachPromise && !newSession && !targetSessionId) {
    await attachPromise
    return
  }
  const requestId = ++latestAttachRequest
  const nextAttach = doAttachToThread(newSession, targetSessionId, requestId)
  attachPromise = nextAttach
  try {
    await nextAttach
  } finally {
    if (attachPromise === nextAttach) {
      attachPromise = null
    }
  }
}

async function doAttachToThread(newSession: boolean, targetSessionId = '', requestId: number): Promise<void> {
  if (!props.threadId || !props.cwd || !terminal) return
  errorMessage.value = ''
  await nextTick()
  fitTerminal()
  try {
    const session = await attachThreadTerminal({
      threadId: props.threadId,
      cwd: props.cwd,
      sessionId: newSession ? undefined : targetSessionId || activeSessionId.value || undefined,
      cols: terminal.cols,
      rows: terminal.rows,
      newSession,
    })
    upsertTab({
      id: session.id,
      shell: session.shell || 'terminal',
      status: 'attached',
    })
    if (requestId !== latestAttachRequest) return
    activeSessionId.value = session.id
    lastResizedTerminalGrid = {
      sessionId: session.id,
      cols: terminal.cols,
      rows: terminal.rows,
    }
    saveTabsState()
    renderSessionBuffer(session.buffer)
  } catch (error) {
    if (requestId !== latestAttachRequest) return
    errorMessage.value = error instanceof Error ? error.message : t('Terminal attach failed')
  }
}

function handleNotification(notification: RpcNotification): void {
  const params = asRecord(notification.params)
  const notificationSessionId = readString(params?.sessionId)
  if (!notificationSessionId || !terminal) return

  if (notification.method === 'terminal-attached') {
    patchTab(notificationSessionId, {
      shell: readString(params?.shell) || undefined,
      status: 'attached',
    })
    saveTabsState()
    return
  }
  if (notification.method === 'terminal-init-log') {
    if (notificationSessionId !== activeSessionId.value) return
    terminal.clear()
    terminal.write(readString(params?.log) || '')
    return
  }
  if (notification.method === 'terminal-data') {
    if (notificationSessionId !== activeSessionId.value) return
    terminal.write(readString(params?.data) || '')
    return
  }
  if (notification.method === 'terminal-exit') {
    patchTab(notificationSessionId, { status: 'exited' })
    saveTabsState()
    if (notificationSessionId !== activeSessionId.value) return
    terminal.writeln('')
    terminal.writeln('[terminal exited]')
    return
  }
  if (notification.method === 'terminal-error') {
    patchTab(notificationSessionId, { status: 'error' })
    saveTabsState()
    if (notificationSessionId !== activeSessionId.value) return
    errorMessage.value = readString(params?.message) || 'Terminal error'
  }
}

function terminalViewportSize(): TerminalVisualViewport {
  if (typeof window === 'undefined') {
    return {
      width: 1200,
      height: 640,
      offsetLeft: 0,
      offsetTop: 0,
    }
  }
  const viewport = window.visualViewport
  return {
    width: Math.max(1, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(viewport?.height ?? window.innerHeight)),
    offsetLeft: Math.max(0, Math.round(viewport?.offsetLeft ?? 0)),
    offsetTop: Math.max(0, Math.round(viewport?.offsetTop ?? 0)),
  }
}

function resetTerminalWindow(): void {
  terminalWindow.value = initialTerminalWindowRect(terminalViewportSize())
}

function clampTerminalWindowToViewport(): void {
  terminalWindow.value = clampTerminalWindowRect(terminalWindow.value, terminalViewportSize())
}

function onTerminalViewportResize(): void {
  clampTerminalWindowToViewport()
  scheduleFitAndResize()
}

function onTerminalHeaderPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary) return
  const target = event.target
  if (target instanceof Element && target.closest('button')) return
  startTerminalWindowGesture('drag', event)
}

function onTerminalResizePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary) return
  startTerminalWindowGesture('resize', event)
}

function startTerminalWindowGesture(kind: TerminalWindowGesture['kind'], event: PointerEvent): void {
  event.preventDefault()
  stopTerminalWindowGesture()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  terminalWindowGesture = {
    kind,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRect: { ...terminalWindow.value },
    target,
  }
  try {
    target.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is unavailable in some embedded browser contexts.
  }
  target.addEventListener('lostpointercapture', onTerminalWindowPointerCaptureLost)
  window.addEventListener('pointermove', onTerminalWindowPointerMove)
  window.addEventListener('pointerup', onTerminalWindowPointerEnd)
  window.addEventListener('pointercancel', onTerminalWindowPointerEnd)
  window.addEventListener('blur', onTerminalWindowBlur)
}

function onTerminalWindowPointerMove(event: PointerEvent): void {
  const gesture = terminalWindowGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const deltaX = event.clientX - gesture.startClientX
  const deltaY = event.clientY - gesture.startClientY
  terminalWindow.value = clampTerminalWindowRect(
    gesture.kind === 'drag'
      ? {
          ...gesture.startRect,
          left: gesture.startRect.left + deltaX,
          top: gesture.startRect.top + deltaY,
        }
      : {
          ...gesture.startRect,
          width: gesture.startRect.width + deltaX,
          height: gesture.startRect.height + deltaY,
        },
    terminalViewportSize(),
  )
}

function onTerminalWindowPointerEnd(event: PointerEvent): void {
  if (!terminalWindowGesture || event.pointerId !== terminalWindowGesture.pointerId) return
  stopTerminalWindowGesture()
}

function onTerminalWindowPointerCaptureLost(event: PointerEvent): void {
  if (!terminalWindowGesture || event.pointerId !== terminalWindowGesture.pointerId) return
  stopTerminalWindowGesture()
}

function onTerminalWindowBlur(): void {
  stopTerminalWindowGesture()
}

function stopTerminalWindowGesture(): void {
  const gesture = terminalWindowGesture
  terminalWindowGesture = null
  if (typeof window === 'undefined') return
  window.removeEventListener('pointermove', onTerminalWindowPointerMove)
  window.removeEventListener('pointerup', onTerminalWindowPointerEnd)
  window.removeEventListener('pointercancel', onTerminalWindowPointerEnd)
  window.removeEventListener('blur', onTerminalWindowBlur)
  if (!gesture) return
  gesture.target.removeEventListener('lostpointercapture', onTerminalWindowPointerCaptureLost)
  if (gesture.target.hasPointerCapture(gesture.pointerId)) {
    gesture.target.releasePointerCapture(gesture.pointerId)
  }
}

function onNewTerminal(): void {
  ctrlShortcutArmed.value = false
  void attachToThread(true)
}

function onHideTerminal(): void {
  ctrlShortcutArmed.value = false
  emit('hide')
}

function toggleCtrlShortcut(): void {
  if (isTerminalInputUnavailable.value) return
  ctrlShortcutArmed.value = !ctrlShortcutArmed.value
  terminal?.focus()
}

function onVirtualTerminalKey(key: TerminalVirtualKey): void {
  if (isTerminalInputUnavailable.value) return
  const data = terminalVirtualKeyInput(key, false)
  terminal?.focus()
  sendTerminalInput(data, t('Terminal input failed'))
}

function sendTerminalInput(data: string, fallbackMessage: string): void {
  const sessionId = activeSessionId.value
  if (!sessionId || !data) return
  void sendThreadTerminalInput(sessionId, data).catch((error: unknown) => {
    errorMessage.value = error instanceof Error ? error.message : fallbackMessage
  })
}

function onTerminalFocusOut(): void {
  window.setTimeout(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof Node && terminalHostRef.value?.contains(activeElement)) return
    emit('terminalFocusChange', false)
  }, 100)
}

function onSelectTab(tabId: string): void {
  if (!tabId || tabId === activeSessionId.value) return
  ctrlShortcutArmed.value = false
  activeSessionId.value = tabId
  terminal?.clear()
  void attachToThread(false, tabId)
}

function onCloseTerminal(): void {
  ctrlShortcutArmed.value = false
  const currentSessionId = activeSessionId.value
  if (!currentSessionId) {
    emit('hide')
    return
  }
  const currentIndex = tabs.value.findIndex((tab) => tab.id === currentSessionId)
  const nextTabs = tabs.value.filter((tab) => tab.id !== currentSessionId)
  tabs.value = nextTabs
  const nextTab = nextTabs[Math.max(0, Math.min(currentIndex, nextTabs.length - 1))]
  if (currentSessionId) {
    void closeThreadTerminal(currentSessionId).catch((error: unknown) => {
      errorMessage.value = error instanceof Error ? error.message : 'Terminal close failed'
    })
  }
  if (nextTab) {
    activeSessionId.value = nextTab.id
    saveTabsState()
    void attachToThread(false, nextTab.id)
    return
  }
  activeSessionId.value = ''
  lastResizedTerminalGrid = null
  terminal?.clear()
  saveTabsState()
  emit('hide')
}

function scheduleFitAndResize(): void {
  if (resizeFrame) return
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0
    fitTerminal()
    reportTerminalGridSize()
  })
}

function fitTerminal(): void {
  try {
    fitAddon?.fit()
  } catch {
    // xterm-fit can throw before fonts/layout settle; the next resize observer tick retries.
  }
}

function reportTerminalGridSize(): void {
  const sessionId = activeSessionId.value
  if (!terminal || !sessionId || terminal.cols < 1 || terminal.rows < 1) return
  const nextGrid = {
    sessionId,
    cols: terminal.cols,
    rows: terminal.rows,
  }
  if (
    lastResizedTerminalGrid?.sessionId === nextGrid.sessionId
    && lastResizedTerminalGrid.cols === nextGrid.cols
    && lastResizedTerminalGrid.rows === nextGrid.rows
  ) return
  lastResizedTerminalGrid = nextGrid
  void resizeThreadTerminal(sessionId, nextGrid.cols, nextGrid.rows).catch(() => {
    if (
      lastResizedTerminalGrid?.sessionId === nextGrid.sessionId
      && lastResizedTerminalGrid.cols === nextGrid.cols
      && lastResizedTerminalGrid.rows === nextGrid.rows
    ) {
      lastResizedTerminalGrid = null
    }
  })
}

function upsertTab(tab: TerminalTab): void {
  const existingIndex = tabs.value.findIndex((row) => row.id === tab.id)
  if (existingIndex < 0) {
    tabs.value = [...tabs.value, tab]
    saveTabsState()
    return
  }
  const next = [...tabs.value]
  next.splice(existingIndex, 1, {
    ...next[existingIndex],
    ...tab,
  })
  tabs.value = next
  saveTabsState()
}

function patchTab(tabId: string, patch: Partial<TerminalTab>): void {
  const existingIndex = tabs.value.findIndex((row) => row.id === tabId)
  if (existingIndex < 0) return
  const next = [...tabs.value]
  next.splice(existingIndex, 1, {
    ...next[existingIndex],
    ...patch,
  })
  tabs.value = next
  saveTabsState()
}

function renderSessionBuffer(buffer: string): void {
  if (!terminal) return
  terminal.clear()
  if (buffer) {
    terminal.write(buffer)
  }
}

function terminalTabTitle(tab: TerminalTab, index: number): string {
  const shell = tab.shell && tab.shell !== 'terminal' ? tab.shell : 'Terminal'
  return tabs.value.length > 1 ? `${shell} ${index + 1}` : shell
}

function restoreSavedTabs(): void {
  const stored = readStoredTabs()[tabStorageKey()]
  if (!stored || stored.tabs.length === 0) {
    tabs.value = []
    activeSessionId.value = ''
    return
  }
  tabs.value = stored.tabs
  activeSessionId.value = stored.activeSessionId && stored.tabs.some((tab) => tab.id === stored.activeSessionId)
    ? stored.activeSessionId
    : stored.tabs[0]?.id ?? ''
}

function saveTabsState(): void {
  if (typeof window === 'undefined') return
  const allTabs = readStoredTabs()
  const key = tabStorageKey()
  if (tabs.value.length === 0 || !activeSessionId.value) {
    delete allTabs[key]
  } else {
    allTabs[key] = {
      activeSessionId: activeSessionId.value,
      tabs: tabs.value.map((tab) => ({ ...tab })),
    }
  }
  window.localStorage.setItem(TERMINAL_TABS_STORAGE_KEY, JSON.stringify(allTabs))
}

function tabStorageKey(): string {
  return `${props.threadId}::${props.cwd}`
}

function readStoredTabs(): Record<string, { activeSessionId: string, tabs: TerminalTab[] }> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const output: Record<string, { activeSessionId: string, tabs: TerminalTab[] }> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = asRecord(value)
      const activeSessionId = readString(record?.activeSessionId)
      const rawTabs = Array.isArray(record?.tabs) ? record.tabs : []
      const nextTabs: TerminalTab[] = []
      for (const rawTab of rawTabs) {
        const tab = asRecord(rawTab)
        const id = readString(tab?.id)
        if (!id) continue
        const rawStatus = readString(tab?.status)
        const status: TerminalTab['status'] =
          rawStatus === 'attached' || rawStatus === 'exited' || rawStatus === 'error'
            ? rawStatus
            : 'connecting'
        nextTabs.push({
          id,
          shell: readString(tab?.shell) || 'terminal',
          status,
        })
      }
      if (nextTabs.length > 0) {
        output[key] = { activeSessionId, tabs: nextTabs }
      }
    }
    return output
  } catch {
    return {}
  }
}

function normalizeQuickCommandValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

async function refreshProjectQuickCommands(): Promise<void> {
  const cwd = props.cwd.trim()
  if (!cwd) {
    projectQuickCommands.value = []
    return
  }
  try {
    projectQuickCommands.value = await getThreadTerminalQuickCommands(cwd)
  } catch {
    projectQuickCommands.value = []
  }
}

async function runQuickCommand(command: string, custom = false): Promise<void> {
  const value = normalizeQuickCommandValue(command)
  if (!value) return
  await waitForTerminalReady()
  if (!activeSessionId.value) {
    await attachToThread(false)
  }
  if (!activeSessionId.value) {
    throw new Error('Terminal is not connected')
  }
  terminal?.focus()
  recordQuickCommandUse(value, custom)
  try {
    await sendThreadTerminalInput(activeSessionId.value, `${value}\r`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Quick command failed'
    throw error
  }
}

async function waitForTerminalReady(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (terminal) return
    await new Promise((resolve) => window.setTimeout(resolve, 25))
  }
  throw new Error('Terminal is not ready')
}

defineExpose<ThreadTerminalPanelExposed>({
  runQuickCommand,
})

function recordQuickCommandUse(value: string, custom: boolean): void {
  const normalized = normalizeQuickCommandValue(value)
  if (!normalized) return
  const existing = storedQuickCommands.value.find((command) => command.value === normalized)
  const projectCommandIndex = projectQuickCommands.value.findIndex((command) => command.value === normalized)
  const projectCommand = projectCommandIndex >= 0 ? projectQuickCommands.value[projectCommandIndex] : null
  const nextCommand: QuickCommand = {
    label: existing?.label || projectCommand?.label || normalized,
    value: normalized,
    custom: existing?.custom === true || (!projectCommand && custom),
    usageCount: (existing?.usageCount ?? 0) + 1,
    lastUsedAt: Date.now(),
    sourceIndex: projectCommandIndex >= 0 ? projectCommandIndex : undefined,
  }
  const next = [
    ...storedQuickCommands.value.filter((command) => command.value !== normalized),
    nextCommand,
  ]
  storedQuickCommands.value = next
  saveStoredQuickCommands(next)
}

function compareQuickCommands(first: QuickCommand, second: QuickCommand): number {
  if (second.usageCount !== first.usageCount) return second.usageCount - first.usageCount
  if (second.lastUsedAt !== first.lastUsedAt) return second.lastUsedAt - first.lastUsedAt
  const firstSource = typeof first.sourceIndex === 'number' ? first.sourceIndex : Number.MAX_SAFE_INTEGER
  const secondSource = typeof second.sourceIndex === 'number' ? second.sourceIndex : Number.MAX_SAFE_INTEGER
  return firstSource - secondSource
}

function loadStoredQuickCommands(): QuickCommand[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(QUICK_COMMAND_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const commands: QuickCommand[] = []
    for (const row of parsed) {
      const record = asRecord(row)
      const value = normalizeQuickCommandValue(readString(record?.value))
      if (!value) continue
      if (seen.has(value)) continue
      seen.add(value)
      commands.push({
        label: readString(record?.label) || value,
        value,
        custom: record?.custom !== false,
        usageCount: readPositiveInteger(record?.usageCount),
        lastUsedAt: readPositiveInteger(record?.lastUsedAt),
      })
    }
    return commands
  } catch {
    return []
  }
}

function saveStoredQuickCommands(commands: QuickCommand[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    QUICK_COMMAND_STORAGE_KEY,
    JSON.stringify(commands.map((command) => ({
      label: command.label,
      value: command.value,
      custom: command.custom === true,
      usageCount: command.usageCount,
      lastUsedAt: command.lastUsedAt,
    }))),
  )
}

function readPositiveInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }
  return 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
</script>

<style scoped>
@reference "tailwindcss";

.thread-terminal-panel {
  @apply fixed z-[260] flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-black shadow-lg;
}

.thread-terminal-drag-handle {
  @apply flex h-5 shrink-0 cursor-grab items-center justify-center border-b border-zinc-800 bg-zinc-950 select-none;
  touch-action: none;
}

.thread-terminal-drag-handle::before {
  content: '';
  @apply h-1 w-10 rounded-full bg-zinc-600;
}

.thread-terminal-drag-handle:active {
  cursor: grabbing;
}

.thread-terminal-header {
  @apply flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-2 select-none;
  cursor: move;
  touch-action: none;
}

.thread-terminal-tabs {
  @apply flex min-w-0 flex-1 items-center gap-1 overflow-x-auto;
}

.thread-terminal-tab {
  @apply flex h-7 min-w-20 max-w-36 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 transition hover:border-zinc-700 hover:text-white;
}

.thread-terminal-tab.is-active {
  @apply border-zinc-700 bg-zinc-800 text-zinc-100;
}

.thread-terminal-dot {
  @apply h-2 w-2 shrink-0 rounded-full bg-zinc-500;
}

.thread-terminal-dot[data-status='attached'] {
  @apply bg-emerald-400;
}

.thread-terminal-dot[data-status='error'] {
  @apply bg-rose-400;
}

.thread-terminal-title {
  @apply truncate;
}

.thread-terminal-actions {
  @apply flex shrink-0 items-center gap-1;
}

.thread-terminal-action {
  @apply cursor-pointer rounded-md border border-transparent px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white;
}

.thread-terminal-error {
  @apply m-0 shrink-0 border-b border-rose-900 bg-rose-950 px-3 py-1.5 text-xs text-rose-200;
}

.thread-terminal-host {
  @apply min-h-0 w-full flex-1 overflow-hidden px-2 py-2;
}

.thread-terminal-host :deep(.xterm) {
  @apply h-full;
}

.thread-terminal-host :deep(.xterm-viewport) {
  @apply bg-black;
}

.thread-terminal-shortcuts {
  @apply flex shrink-0 flex-wrap items-center gap-1 border-t border-zinc-800 bg-zinc-950 px-1.5 py-1.5 pr-9;
}

.thread-terminal-shortcut {
  @apply inline-flex h-8 min-w-9 cursor-pointer items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45;
}

.thread-terminal-shortcut[aria-pressed='true'] {
  @apply border-cyan-400 bg-cyan-500 text-zinc-950;
}

.thread-terminal-shortcut-icon {
  @apply w-8 min-w-8 px-0;
}

.thread-terminal-shortcut-arrow {
  @apply h-4 w-4;
}

.thread-terminal-shortcut-arrow-left {
  transform: rotate(-90deg);
}

.thread-terminal-shortcut-arrow-down {
  transform: rotate(180deg);
}

.thread-terminal-shortcut-arrow-right {
  transform: rotate(90deg);
}

.thread-terminal-resize-handle {
  @apply absolute bottom-0 right-0 z-10 flex h-8 w-8 cursor-nwse-resize items-end justify-end p-1 text-zinc-500 transition hover:text-zinc-200;
  touch-action: none;
}

.thread-terminal-resize-icon {
  @apply h-3.5 w-3.5;
}

@media (max-width: 767px) {
  .thread-terminal-header {
    @apply px-1.5;
  }

  .thread-terminal-action {
    @apply px-1.5 text-[11px];
  }

  .thread-terminal-host {
    @apply px-1.5 py-1.5;
  }

}
</style>
