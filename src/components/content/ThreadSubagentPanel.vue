<template>
  <Teleport v-if="isMobile" to="#thread-subagent-header-target">
    <button
      v-if="parentThreadId && !mobileSheetOpen"
      type="button"
      class="subagent-header-trigger"
      :aria-label="`Show ${allAgents.length} agents`"
      :title="`Show ${allAgents.length} agents`"
      @click="toggleSubagentPanel"
    >
      <IconTablerLayoutSidebarFilled class="subagent-header-trigger-icon" />
    </button>
  </Teleport>

  <Teleport to="body" :disabled="!isMobile || !mobileSheetOpen">
    <div
      v-if="parentThreadId && (!isMobile || allAgents.length > 0 || historyOpened)"
      ref="desktopHostRef"
      class="subagent-panel-host"
      :class="{ 'is-desktop-collapsed': !isMobile && !desktopPanelExpanded }"
      :style="desktopHostStyle"
    >
      <div v-if="!isMobile" class="subagent-desktop-toolbar">
        <button
          type="button"
          class="subagent-header-trigger"
          :aria-label="`Show ${allAgents.length} agents`"
          :aria-expanded="desktopPanelExpanded"
          :title="desktopPanelCanExpand ? `Show ${allAgents.length} agents` : 'Agents sidebar needs more space'"
          :disabled="!desktopPanelCanExpand"
          @click="toggleSubagentPanel"
        >
          <IconTablerLayoutSidebar v-if="desktopPanelExpanded" class="subagent-header-trigger-icon" />
          <IconTablerLayoutSidebarFilled v-else class="subagent-header-trigger-icon" />
        </button>
      </div>
      <div v-show="isMobile || desktopPanelExpanded" class="subagent-panel-body">
        <div
          v-if="!isMobile && desktopPanelExpanded"
          class="subagent-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agents sidebar"
          tabindex="0"
          :aria-valuemin="MIN_DESKTOP_PANEL_WIDTH"
          :aria-valuemax="desktopPanelMaximum"
          :aria-valuenow="desktopPanelRenderedWidth"
          @pointerdown="onDesktopResizePointerDown"
          @keydown="onDesktopResizerKeyDown"
        />

        <aside
          class="subagent-panel"
          :class="{ 'is-mobile-open': isMobile && mobileSheetOpen }"
          @click.self="closeMobileSheet"
        >
          <section class="subagent-panel-surface" @click.stop>
            <div v-if="isMobile && mobileSheetOpen" class="subagent-sheet-handle" aria-hidden="true" />
            <header class="subagent-panel-header">
              <button
                v-if="selectedAgent"
                type="button"
                class="subagent-icon-button"
                aria-label="Back to agents"
                title="Back to agents"
                @click="closeDetail"
              >
                <IconTablerChevronLeft />
              </button>
              <div class="subagent-header-copy">
                <p class="subagent-panel-title">{{ selectedAgent ? `Agent ${selectedAgentIndex + 1}` : 'Agents' }}</p>
                <p v-if="selectedAgent" class="subagent-detail-status" :data-status="selectedAgent.status">{{ selectedAgent.status }}</p>
              </div>
              <span v-if="!selectedAgent && (!isMobile || !mobileSheetOpen)" class="subagent-panel-count">{{ allAgents.length }}</span>
              <button
                v-if="isMobile && mobileSheetOpen"
                type="button"
                class="subagent-icon-button"
                aria-label="Close agents"
                title="Close agents"
                @click="mobileSheetOpen = false"
              >
                <IconTablerX />
              </button>
            </header>

            <div v-if="!selectedAgent" class="thread-feature-modes" role="group" aria-label="Agent status">
              <button type="button" :aria-pressed="agentView === 'running'" @click="agentView = 'running'">Running ({{ activeAgents.length }})</button>
              <button type="button" :aria-pressed="agentView === 'history'" @click="agentView = 'history'; if (!historyStarted) loadHistory()">History ({{ allAgents.length - activeAgents.length }})</button>
            </div>
            <div v-if="!selectedAgent" class="subagent-list">
              <button
                v-for="(agent, index) in visibleAgents"
                :key="agent.threadId"
                type="button"
                class="subagent-row"
                :data-status="agent.status"
                @click="selectAgent(agent.threadId)"
              >
                <span class="subagent-row-title">
                  <span class="subagent-status-dot" :data-status="agent.status" />
                  <span>Agent {{ index + 1 }}</span>
                </span>
                <span class="subagent-row-status">{{ agent.status }}</span>
                <span class="subagent-row-preview">{{ agent.message || agent.prompt || 'No task details' }}</span>
              </button>
              <p v-if="!visibleAgents.length" class="thread-feature-status">No agents</p>
              <p v-if="historyError" class="thread-feature-error" role="alert">{{ historyError }}</p>
              <p v-if="historyUnsupported" class="thread-feature-status">Loaded collaboration only</p>
              <button v-if="!historyComplete && !historyUnsupported" class="thread-feature-action" type="button" :disabled="historyLoading" @click="loadHistory">{{ historyLoading ? 'Loading...' : historyStarted ? 'Load older collaboration' : 'Load history' }}</button>
              <button v-if="historyUnsupported" class="thread-feature-action" type="button" @click="historyUnsupported = false; loadHistory()">Retry</button>
            </div>

            <template v-else>
              <p v-if="selectedAgent.prompt" class="subagent-detail-prompt">{{ selectedAgent.prompt }}</p>
              <details v-if="selectedAgent.communications?.length" class="subagent-communications">
                <summary>Collaboration ({{ selectedAgent.communications.length }})</summary>
                <div v-for="event in selectedAgent.communications" :key="event.id" class="subagent-communication">
                  <strong>{{ event.tool }} · {{ event.status }}</strong>
                  <small>{{ event.senderThreadId }} -&gt; {{ event.receiverThreadIds.join(', ') }}</small>
                  <pre v-if="event.prompt">{{ event.prompt }}</pre>
                  <template v-for="(state, id) in event.agentsStates" :key="id"><small>{{ id }} · {{ state.status }}</small><pre v-if="state.message">{{ state.message }}</pre></template>
                </div>
              </details>
              <p v-if="loadingThreadId === selectedAgent.threadId" class="subagent-detail-loading">Loading agent thread...</p>
              <p v-if="detailError" class="subagent-detail-error">{{ detailError }} <button type="button" @click="retryAgentWindow">Retry</button></p>
              <ThreadConversation
                v-if="selectedDetail"
                class="subagent-conversation"
                :messages="selectedMessages"
                :pending-requests="[]"
                :live-overlay="selectedLiveOverlay"
                :is-loading="false"
                :active-thread-id="selectedAgent.threadId"
                :cwd="cwd"
                :readonly="true"
                :has-more-persisted-above="selectedDetail.hasMoreOlder"
                :is-loading-persisted-above="loadingOlder"
                :load-earlier-messages="loadAgentOlderMessages"
                :has-more-persisted-below="selectedDetail.hasMoreNewer"
                :is-history-window="selectedDetail.hasMoreNewer === true"
                :is-loading-persisted-below="loadingNewer"
                :load-later-messages="loadAgentNewerMessages"
                :load-latest-messages="loadAgentLatestMessages"
              />
            </template>
          </section>
        </aside>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getThreadCollaborationPage, type UiSubagent } from '../../api/codexGateway'
import { useThreadHistoryWindow } from '../../composables/useThreadHistoryWindow'
import { mergeSubagents } from '../../agentCollaboration'
import { isNativeHistoryUnsupported } from '../../api/threadSearch'
import { useMobile } from '../../composables/useMobile'
import type { UiLiveOverlay, UiMessage } from '../../types/codex'
import IconTablerChevronLeft from '../icons/IconTablerChevronLeft.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import ThreadConversation from './ThreadConversation.vue'
import {
  clampDesktopPanelWidth,
  canExpandDesktopPanel,
  DESKTOP_PANEL_COLLAPSED_WIDTH,
  DEFAULT_DESKTOP_PANEL_WIDTH,
  desktopPanelWidthAfterDrag,
  effectiveDesktopPanelWidth,
  isActiveSubagentStatus,
  mergeCurrentSubagentMessages,
  MAX_DESKTOP_PANEL_WIDTH,
  maximumDesktopPanelWidth,
  MIN_DESKTOP_PANEL_WIDTH,
  readStoredDesktopPanelWidth,
} from './threadSubagentPanelState'

const props = defineProps<{
  parentThreadId: string
  agents: UiSubagent[]
  cwd: string
  liveOverlayForThread: (threadId: string) => UiLiveOverlay | null
  liveMessagesForThread: (threadId: string) => UiMessage[]
  prepareSnapshotForThread: (threadId: string) => (messages: UiMessage[]) => void
}>()

const DESKTOP_PANEL_WIDTH_KEY = 'codex-web-local.subagent-panel-width.v1'
const DESKTOP_PANEL_COLLAPSED_KEY = 'codex-web-local.subagent-panel-collapsed.v1'
const DESKTOP_PANEL_KEYBOARD_STEP = 16

type DesktopPanelResizeGesture = {
  pointerId: number
  startClientX: number
  startWidth: number
  layoutWidth: number
  target: HTMLElement
}

const { isMobile } = useMobile()
const mobileSheetOpen = ref(false)
const desktopHostRef = ref<HTMLElement | null>(null)
const desktopPanelWidth = ref(loadDesktopPanelWidth())
const desktopLayoutWidth = ref(typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth)
const desktopPanelCollapsed = ref(loadDesktopPanelCollapsed())
const selectedThreadId = ref('')
const loadingThreadId = ref('')
const {
  detail: selectedDetail, error: detailError, loadingOlder, loadingNewer,
  loading: agentWindowLoading,
  loadLatest: loadAgentLatestMessages, loadOlder: loadAgentOlderMessages,
  loadNewer: loadAgentNewerMessages, reset: resetAgentWindow, retry: retryAgentHistory,
} = useThreadHistoryWindow(selectedThreadId, props.prepareSnapshotForThread)
let detailRequestId = 0
let historyRequestId = 0
const historyAgents = ref<UiSubagent[]>([])
const historyCursor = ref<string | null>(null)
const historyStarted = ref(false)
const historyComplete = ref(false)
const historyOpened = ref(false)
const historyLoading = ref(false)
const historyUnsupported = ref(false)
const historyError = ref('')
const agentView = ref<'running' | 'history'>('running')
let desktopPanelResizeGesture: DesktopPanelResizeGesture | null = null
let desktopLayoutResizeObserver: ResizeObserver | null = null

const allAgents = computed(() => mergeSubagents(historyAgents.value, props.agents))
const activeAgents = computed(() => allAgents.value.filter((agent) => isActiveSubagentStatus(agent.status)))
const visibleAgents = computed(() => allAgents.value.filter((agent) => agentView.value === 'running' ? isActiveSubagentStatus(agent.status) : !isActiveSubagentStatus(agent.status)))
const selectedAgent = computed(() => allAgents.value.find((agent) => agent.threadId === selectedThreadId.value) ?? null)
const selectedAgentIndex = computed(() => allAgents.value.findIndex((agent) => agent.threadId === selectedThreadId.value))
const selectedLiveOverlay = computed(() => selectedAgent.value && !selectedDetail.value?.hasMoreNewer
  ? props.liveOverlayForThread(selectedAgent.value.threadId) : null)
const selectedMessages = computed(() => {
  const detail = selectedDetail.value
  if (!detail) return []
  if (detail.hasMoreNewer || !selectedAgent.value) return detail.messages
  const live = props.liveMessagesForThread(selectedAgent.value.threadId)
  if (!detail.inProgress && !isActiveSubagentStatus(selectedAgent.value.status)) {
    const persistedIds = new Set(detail.messages.map((message) => message.id))
    return [...detail.messages, ...live.filter((message) => !persistedIds.has(message.id))]
  }
  return mergeCurrentSubagentMessages(detail.messages, live)
})
const desktopPanelMaximum = computed(() => maximumDesktopPanelWidth(desktopLayoutWidth.value))
const desktopPanelRenderedWidth = computed(() => effectiveDesktopPanelWidth(desktopPanelWidth.value, desktopLayoutWidth.value))
const desktopPanelCanExpand = computed(() => canExpandDesktopPanel(desktopLayoutWidth.value))
const desktopPanelExpanded = computed(() => desktopPanelCanExpand.value && !desktopPanelCollapsed.value && (allAgents.value.length > 0 || historyOpened.value))
const desktopHostStyle = computed<Record<string, string>>(() => ({
  '--subagent-panel-width': `${desktopPanelExpanded.value ? desktopPanelRenderedWidth.value : DESKTOP_PANEL_COLLAPSED_WIDTH}px`,
}))

function loadDesktopPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DESKTOP_PANEL_WIDTH
  return readStoredDesktopPanelWidth(window.localStorage.getItem(DESKTOP_PANEL_WIDTH_KEY))
}

function loadDesktopPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(DESKTOP_PANEL_COLLAPSED_KEY) === '1'
}

function saveDesktopPanelWidth(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DESKTOP_PANEL_WIDTH_KEY, String(clampDesktopPanelWidth(desktopPanelWidth.value)))
}

function toggleDesktopPanel(): void {
  finishDesktopResizeGesture()
  desktopPanelCollapsed.value = !desktopPanelCollapsed.value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DESKTOP_PANEL_COLLAPSED_KEY, desktopPanelCollapsed.value ? '1' : '0')
  }
}

function toggleSubagentPanel(): void {
  if (!isMobile.value && !desktopPanelCanExpand.value) return
  const openingEmptyPanel = !allAgents.value.length && !historyOpened.value
  if (openingEmptyPanel) {
    historyOpened.value = true
    if (!isMobile.value && desktopPanelCollapsed.value) toggleDesktopPanel()
  }
  if (isMobile.value) mobileSheetOpen.value = true
  else if (!openingEmptyPanel) toggleDesktopPanel()
  if ((isMobile.value || desktopPanelExpanded.value) && !historyStarted.value) void loadHistory()
}

async function loadHistory(): Promise<void> {
  if (historyLoading.value || historyComplete.value || historyUnsupported.value || !props.parentThreadId) return
  const request = ++historyRequestId
  historyLoading.value = true
  historyError.value = ''
  try {
    const page = await getThreadCollaborationPage(props.parentThreadId, historyCursor.value)
    if (request !== historyRequestId) return
    if (page.nextCursor && page.nextCursor === historyCursor.value) throw new Error('Repeated collaboration cursor')
    historyAgents.value = mergeSubagents(page.data, historyAgents.value)
    historyCursor.value = page.nextCursor
    historyStarted.value = true
    historyComplete.value = !page.nextCursor
  } catch (failure) {
    if (request !== historyRequestId) return
    if (isNativeHistoryUnsupported(failure)) historyUnsupported.value = true
    else historyError.value = failure instanceof Error ? failure.message : 'Failed to load collaboration'
  } finally { if (request === historyRequestId) historyLoading.value = false }
}

function closeMobileSheet(): void {
  if (isMobile.value) mobileSheetOpen.value = false
}

function readDesktopLayoutWidth(): number {
  const measuredWidth = desktopHostRef.value?.closest<HTMLElement>('.content-root')?.getBoundingClientRect().width ?? 0
  if (measuredWidth > 0) desktopLayoutWidth.value = measuredWidth
  return measuredWidth > 0 ? measuredWidth : desktopLayoutWidth.value
}

function onDesktopLayoutResize(entries: ResizeObserverEntry[]): void {
  const width = entries[0]?.contentRect.width ?? 0
  if (width > 0) desktopLayoutWidth.value = width
}

function observeDesktopLayout(host: HTMLElement | null): void {
  desktopLayoutResizeObserver?.disconnect()
  desktopLayoutResizeObserver = null
  const layout = isMobile.value ? null : host?.closest<HTMLElement>('.content-root')
  if (!layout) return

  const width = layout.getBoundingClientRect().width
  if (width > 0) desktopLayoutWidth.value = width
  if (typeof ResizeObserver === 'undefined') return
  desktopLayoutResizeObserver = new ResizeObserver(onDesktopLayoutResize)
  desktopLayoutResizeObserver.observe(layout)
}

function onDesktopResizePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary || isMobile.value) return
  event.preventDefault()
  stopDesktopResizeGesture()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return

  desktopPanelResizeGesture = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startWidth: desktopHostRef.value?.getBoundingClientRect().width ?? desktopPanelWidth.value,
    layoutWidth: readDesktopLayoutWidth(),
    target,
  }
  try {
    target.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is unavailable in some embedded browser contexts.
  }
  target.addEventListener('lostpointercapture', onDesktopResizePointerCaptureLost)
  window.addEventListener('pointermove', onDesktopResizePointerMove)
  window.addEventListener('pointerup', onDesktopResizePointerEnd)
  window.addEventListener('pointercancel', onDesktopResizePointerEnd)
  window.addEventListener('blur', onDesktopResizeWindowBlur)
}

function onDesktopResizePointerMove(event: PointerEvent): void {
  const gesture = desktopPanelResizeGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return
  desktopPanelWidth.value = desktopPanelWidthAfterDrag(
    gesture.startWidth,
    gesture.startClientX,
    event.clientX,
    gesture.layoutWidth,
  )
}

function onDesktopResizePointerEnd(event: PointerEvent): void {
  if (!desktopPanelResizeGesture || event.pointerId !== desktopPanelResizeGesture.pointerId) return
  finishDesktopResizeGesture()
}

function onDesktopResizePointerCaptureLost(event: PointerEvent): void {
  if (!desktopPanelResizeGesture || event.pointerId !== desktopPanelResizeGesture.pointerId) return
  finishDesktopResizeGesture()
}

function onDesktopResizeWindowBlur(): void {
  finishDesktopResizeGesture()
}

function finishDesktopResizeGesture(): void {
  if (!desktopPanelResizeGesture) return
  saveDesktopPanelWidth()
  stopDesktopResizeGesture()
}

function stopDesktopResizeGesture(): void {
  const gesture = desktopPanelResizeGesture
  desktopPanelResizeGesture = null
  if (typeof window === 'undefined') return
  window.removeEventListener('pointermove', onDesktopResizePointerMove)
  window.removeEventListener('pointerup', onDesktopResizePointerEnd)
  window.removeEventListener('pointercancel', onDesktopResizePointerEnd)
  window.removeEventListener('blur', onDesktopResizeWindowBlur)
  if (!gesture) return
  gesture.target.removeEventListener('lostpointercapture', onDesktopResizePointerCaptureLost)
  if (gesture.target.hasPointerCapture(gesture.pointerId)) {
    gesture.target.releasePointerCapture(gesture.pointerId)
  }
}

function onDesktopResizerKeyDown(event: KeyboardEvent): void {
  const maximum = maximumDesktopPanelWidth(readDesktopLayoutWidth())
  let nextWidth = desktopPanelRenderedWidth.value
  if (event.key === 'ArrowLeft') nextWidth += DESKTOP_PANEL_KEYBOARD_STEP
  else if (event.key === 'ArrowRight') nextWidth -= DESKTOP_PANEL_KEYBOARD_STEP
  else if (event.key === 'Home') nextWidth = MIN_DESKTOP_PANEL_WIDTH
  else if (event.key === 'End') nextWidth = maximum
  else return

  event.preventDefault()
  desktopPanelWidth.value = clampDesktopPanelWidth(nextWidth, maximum)
  saveDesktopPanelWidth()
}

async function selectAgent(threadId: string, force = false): Promise<void> {
  if (!allAgents.value.some((agent) => agent.threadId === threadId)) return
  if (selectedThreadId.value !== threadId) {
    selectedDetail.value = null
    loadingOlder.value = false
  }
  selectedThreadId.value = threadId
  detailError.value = ''
  if (selectedDetail.value && !force) return

  const requestId = ++detailRequestId
  loadingOlder.value = false
  loadingThreadId.value = threadId
  try {
    await loadAgentLatestMessages()
    if (requestId !== detailRequestId || selectedThreadId.value !== threadId) return
  } catch (error) {
    if (requestId !== detailRequestId || selectedThreadId.value !== threadId) return
    detailError.value = error instanceof Error ? error.message : 'Failed to load agent thread.'
  } finally {
    if (requestId === detailRequestId && loadingThreadId.value === threadId) {
      loadingThreadId.value = ''
    }
  }
}

function closeDetail(): void {
  detailRequestId += 1
  resetAgentWindow()
  selectedThreadId.value = ''
  detailError.value = ''
  loadingThreadId.value = ''
  selectedDetail.value = null
  loadingOlder.value = false
}

async function retryAgentWindow(): Promise<void> {
  try { await retryAgentHistory() } catch { /* The history window exposes the error. */ }
}

watch(
  allAgents,
  (agents) => {
    if (selectedThreadId.value && !agents.some((agent) => agent.threadId === selectedThreadId.value)) {
      closeDetail()
    }
  },
)

watch(() => [selectedAgent.value?.threadId, selectedAgent.value?.status], ([threadId, status], previous) => {
  if (threadId && threadId === previous?.[0] && status !== previous?.[1] && !isActiveSubagentStatus(status)
    && !loadingOlder.value && !loadingNewer.value && !agentWindowLoading.value
    && !selectedDetail.value?.hasMoreNewer) void selectAgent(threadId, true)
})

watch(() => props.parentThreadId, () => {
  historyRequestId += 1
  mobileSheetOpen.value = false
  closeDetail()
  historyAgents.value = []
  historyCursor.value = null
  historyStarted.value = historyComplete.value = historyOpened.value = historyLoading.value = historyUnsupported.value = false
  historyError.value = ''
  agentView.value = 'running'
})

watch(() => [desktopHostRef.value, isMobile.value, mobileSheetOpen.value], () => {
  observeDesktopLayout(desktopHostRef.value)
}, { flush: 'post' })

watch(isMobile, (mobile) => {
  if (mobile) finishDesktopResizeGesture()
  else mobileSheetOpen.value = false
})

onBeforeUnmount(() => {
  historyRequestId += 1
  detailRequestId += 1
  stopDesktopResizeGesture()
  desktopLayoutResizeObserver?.disconnect()
})
</script>

<style scoped>
@reference "tailwindcss";

.subagent-panel-host {
  @apply hidden;
}

.subagent-panel {
  @apply hidden min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-white;
}

.subagent-desktop-toolbar {
  @apply flex h-14 shrink-0 items-start justify-end;
  padding: 16px 12px 0 5px;
}

.subagent-panel-body {
  @apply flex min-h-0 min-w-0 flex-1;
}

.subagent-panel-surface {
  @apply flex min-h-0 min-w-0 w-full flex-1 flex-col;
}

.subagent-header-trigger {
  @apply inline-flex h-6.75 w-6.75 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-zinc-600 transition hover:border-zinc-200 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50;
}

.subagent-header-trigger-icon,
.subagent-icon-button :deep(svg) {
  @apply h-4 w-4;
}

.subagent-panel-header {
  @apply flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2.5;
}

.subagent-header-copy {
  @apply min-w-0 flex-1;
}

.subagent-panel-title,
.subagent-detail-status,
.subagent-detail-prompt,
.subagent-detail-loading,
.subagent-detail-error {
  @apply m-0;
}

.subagent-panel-title {
  @apply text-sm font-semibold text-slate-900;
}

.subagent-panel-count,
.subagent-row-status,
.subagent-detail-status {
  @apply text-xs font-medium text-slate-500;
}

.subagent-list {
  @apply min-h-0 flex-1 overflow-y-auto p-2;
}

.subagent-row {
  @apply mb-1 flex w-full flex-col gap-1 rounded-md border border-transparent px-2.5 py-2 text-left transition hover:border-slate-200 hover:bg-slate-50;
}

.subagent-row-title {
  @apply flex items-center gap-2 text-sm font-medium text-slate-800;
}

.subagent-status-dot {
  @apply h-2 w-2 shrink-0 rounded-full bg-slate-400;
}

.subagent-status-dot[data-status='running'] {
  @apply bg-amber-500;
}

.subagent-status-dot[data-status='completed'] {
  @apply bg-emerald-500;
}

.subagent-status-dot[data-status='errored'],
.subagent-status-dot[data-status='failed'],
.subagent-status-dot[data-status='notFound'] {
  @apply bg-rose-500;
}

.subagent-row-preview,
.subagent-detail-prompt,
.subagent-detail-error {
  @apply text-xs leading-5 text-slate-500;
}

.subagent-row-preview {
  @apply line-clamp-2;
}

.subagent-detail-status[data-status='completed'] {
  @apply text-emerald-600;
}

.subagent-detail-status[data-status='errored'],
.subagent-detail-status[data-status='failed'],
.subagent-detail-status[data-status='notFound'] {
  @apply text-rose-600;
}

.subagent-detail-prompt {
  @apply shrink-0 border-b border-slate-100 px-3 py-2 line-clamp-2;
}

.subagent-detail-loading,
.subagent-detail-error {
  @apply px-3 py-2;
}

.subagent-detail-error {
  @apply text-rose-600;
}

.subagent-conversation {
  @apply min-h-0 flex-1;
}

.subagent-icon-button {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900;
}

.subagent-panel-resizer {
  @apply hidden;
}

.subagent-header-trigger :deep(svg) {
  transform: scaleX(-1);
}

.subagent-sheet-handle {
  @apply mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300;
}

@media (min-width: 768px) {
  .subagent-panel-host {
    @apply relative flex min-h-0 min-w-0 shrink-0 flex-col;
    width: var(--subagent-panel-width, 44px);
  }

  .subagent-panel-body {
    padding: 4px 12px 16px 0;
  }

  .subagent-panel {
    @apply flex;
  }

  .subagent-panel-resizer {
    @apply relative block w-2 shrink-0 cursor-col-resize;
    touch-action: none;
  }

  .subagent-panel-resizer::before {
    content: '';
    @apply absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300 transition-colors;
  }

  .subagent-panel-resizer:hover::before {
    @apply bg-sky-500;
  }

  .subagent-panel-resizer:focus-visible {
    @apply outline-none;
  }

  .subagent-panel-resizer:focus-visible::before {
    @apply w-0.5 bg-sky-500;
  }

}

@media (max-width: 767px) {
  .subagent-panel-host {
    display: contents;
  }

  .subagent-panel-body {
    display: contents;
  }

  .subagent-panel.is-mobile-open {
    @apply fixed inset-0 z-[270] flex w-full items-end rounded-none border-0 bg-slate-950/40;
  }

  .subagent-panel.is-mobile-open .subagent-panel-surface {
    @apply h-[min(78dvh,42rem)] w-full rounded-t-lg bg-white shadow-2xl;
  }
}

</style>
