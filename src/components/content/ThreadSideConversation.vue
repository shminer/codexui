<template>
  <Teleport :to="popupTarget ?? 'body'">
    <div v-show="visible" class="side-conversation-host" :class="{ 'side-conversation-host--popup': popupTarget }" @click.self="emit('minimize')">
      <section
        class="side-conversation-panel"
        role="dialog"
        :aria-modal="isMobile ? 'true' : undefined"
        :aria-labelledby="titleId"
        :style="isMobile || popupTarget ? undefined : sideConversationWindowStyle"
        @click.stop
      >
        <div class="side-conversation-handle" aria-hidden="true" />
        <header class="side-conversation-header" @pointerdown="onSideConversationHeaderPointerDown">
          <h2 :id="titleId" class="side-conversation-title">{{ t('Side conversation') }}</h2>
          <button
            v-if="!popupTarget"
            class="side-conversation-icon-button"
            type="button"
            :aria-label="t('Open in new window')"
            :title="t('Open in new window')"
            @click="popOut"
          >
            <IconTablerMaximize />
          </button>
          <button
            class="side-conversation-icon-button"
            type="button"
            :aria-label="t('Minimize side conversation')"
            :title="t('Minimize side conversation')"
            @click="emit('minimize')"
          >
            <IconTablerMinimize />
          </button>
          <button
            class="side-conversation-icon-button"
            type="button"
            :aria-label="t('End side conversation')"
            :title="t('End side conversation')"
            @click="emit('end')"
          >
            <IconTablerX />
          </button>
        </header>

        <div class="side-conversation-body">
          <p v-if="isOpening" class="side-conversation-status">{{ t('Opening side conversation...') }}</p>
          <ThreadConversation
            v-else
            class="side-conversation-thread"
            :messages="messages"
            :pending-requests="pendingRequests"
            :live-overlay="liveOverlay"
            :is-loading="false"
            :active-thread-id="threadId"
            :cwd="cwd"
            :readonly="true"
          />
        </div>

        <p v-if="error" class="side-conversation-error" role="alert">{{ error }}</p>

        <ThreadPendingRequestPanel
          v-if="pendingRequests[0]"
          class="side-conversation-request"
          :request="pendingRequests[0]"
          :request-count="pendingRequests.length"
          :has-queue-above="false"
          @respond-server-request="emit('respond-server-request', $event)"
        />
        <div v-show="!pendingRequests[0]" class="side-conversation-composer">
          <ThreadComposer
            ref="composerRef"
            :active-thread-id="threadId"
            :owner-document="popupTarget?.ownerDocument"
            :persist-draft="false"
            :allow-goal="false"
            :allow-side-conversation="false"
            :cwd="cwd"
            :collaboration-modes="collaborationModes"
            :selected-collaboration-mode="selectedCollaborationMode"
            :models="models"
            :selected-model="selectedModel"
            :supported-reasoning-efforts="supportedReasoningEfforts"
            :selected-reasoning-effort="selectedReasoningEffort"
            :selected-speed-mode="selectedSpeedMode"
            :skills="skills"
            :is-turn-in-progress="isTurnInProgress"
            :has-queue-above="queuedMessages.length > 0"
            :send-with-enter="sendWithEnter"
            :in-progress-submit-mode="inProgressSubmitMode"
            :disabled="isOpening || !threadId"
            @submit="emit('send', $event)"
            @interrupt="emit('interrupt')"
            @update:selected-collaboration-mode="emit('update:selected-collaboration-mode', $event)"
            @update:selected-model="emit('update:selected-model', $event)"
            @update:selected-reasoning-effort="emit('update:selected-reasoning-effort', $event)"
            @update:selected-speed-mode="emit('update:selected-speed-mode', $event)"
          >
            <template #queue>
              <QueuedMessages
                :messages="queuedMessages"
                @edit="emit('edit-queued-message', $event)"
                @steer="emit('steer-queued-message', $event)"
                @delete="emit('remove-queued-message', $event)"
                @reorder="emit('reorder-queued-message', $event)"
              />
            </template>
          </ThreadComposer>
        </div>
        <div
          v-if="!isMobile && !popupTarget"
          class="side-conversation-resize-handle"
          role="separator"
          aria-orientation="vertical"
          :aria-label="t('Resize side conversation')"
          :aria-valuemin="sideConversationWindowWidthRange.minimum"
          :aria-valuemax="sideConversationWindowWidthRange.maximum"
          :aria-valuenow="sideConversationWindow.width"
          :aria-valuetext="sideConversationWindowSizeText"
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          :title="t('Resize side conversation')"
          tabindex="0"
          @pointerdown="onSideConversationResizePointerDown"
          @keydown="onSideConversationResizeKeydown"
        >
          <IconTablerMaximize />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { CollaborationModeKind, CollaborationModeOption, ReasoningEffort, SpeedMode, UiLiveOverlay, UiMessage, UiServerRequest, UiServerRequestReply } from '../../types/codex'
import { useMobile } from '../../composables/useMobile'
import { useUiLanguage } from '../../composables/useUiLanguage'
import IconTablerMaximize from '../icons/IconTablerMaximize.vue'
import IconTablerMinimize from '../icons/IconTablerMinimize.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import QueuedMessages from './QueuedMessages.vue'
import ThreadConversation from './ThreadConversation.vue'
import ThreadComposer, { type SubmitPayload, type ThreadComposerExposed } from './ThreadComposer.vue'
import ThreadPendingRequestPanel from './ThreadPendingRequestPanel.vue'
import {
  clampTerminalWindowRect,
  initialSideConversationWindowRect,
  type TerminalFloatingWindowRect,
  type TerminalVisualViewport,
} from './terminalFloatingWindow'

type SideConversationWindowGesture = {
  kind: 'drag' | 'resize'
  pointerId: number
  startClientX: number
  startClientY: number
  startRect: TerminalFloatingWindowRect
  target: HTMLElement
}

defineProps<{
  threadId: string
  cwd: string
  messages: UiMessage[]
  pendingRequests: UiServerRequest[]
  liveOverlay: UiLiveOverlay | null
  error: string
  isOpening: boolean
  isTurnInProgress: boolean
  collaborationModes: CollaborationModeOption[]
  selectedCollaborationMode: CollaborationModeKind
  models: string[]
  selectedModel: string
  supportedReasoningEfforts: ReasoningEffort[]
  selectedReasoningEffort: ReasoningEffort | ''
  selectedSpeedMode: SpeedMode
  skills: Array<{ name: string; displayName?: string; description: string; path: string; scope?: string; enabled?: boolean }>
  queuedMessages: Array<{ id: string; text: string; imageUrls: string[]; skills: Array<{ name: string; path: string }>; fileAttachments: Array<{ label: string; path: string; fsPath: string }>; collaborationMode: CollaborationModeKind }>
  inProgressSubmitMode: 'steer' | 'queue'
  sendWithEnter?: boolean
  visible: boolean
}>()

const emit = defineEmits<{
  minimize: []
  end: []
  send: [payload: SubmitPayload]
  interrupt: []
  'update:selected-collaboration-mode': [mode: CollaborationModeKind]
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
  'update:selected-speed-mode': [mode: SpeedMode]
  'edit-queued-message': [messageId: string]
  'steer-queued-message': [messageId: string]
  'remove-queued-message': [messageId: string]
  'reorder-queued-message': [payload: { draggedId: string; targetId: string }]
  'respond-server-request': [reply: UiServerRequestReply]
}>()

const { isMobile } = useMobile()
const { t } = useUiLanguage()
const titleId = 'side-conversation-title'
const SIDE_CONVERSATION_KEYBOARD_RESIZE_STEP = 16
const composerRef = ref<ThreadComposerExposed | null>(null)
const popupTarget = shallowRef<HTMLElement | null>(null)
let popupWindow: Window | null = null
let popupThemeObserver: MutationObserver | null = null

function returnFromPopup(): void {
  popupThemeObserver?.disconnect()
  popupThemeObserver = null
  popupTarget.value = null
  popupWindow = null
}

function closePopup(): void {
  const opened = popupWindow
  returnFromPopup()
  opened?.close()
}

function popOut(): void {
  if (popupWindow && !popupWindow.closed) {
    popupWindow.focus()
    return
  }
  const opened = window.open('', '_blank', isMobile.value ? undefined : 'popup,width=760,height=900')
  if (!opened) return
  stopSideConversationWindowGesture()
  const popupDocument = opened.document
  popupDocument.title = t('Side conversation')
  const viewport = popupDocument.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content
    ?? 'width=device-width, initial-scale=1.0'
  popupDocument.head.appendChild(viewport)
  const base = popupDocument.createElement('base')
  base.href = document.baseURI
  popupDocument.head.appendChild(base)
  for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    popupDocument.head.appendChild(style.cloneNode(true))
  }
  const syncTheme = (): void => {
    popupDocument.documentElement.className = document.documentElement.className
    popupDocument.documentElement.style.cssText = document.documentElement.style.cssText
  }
  syncTheme()
  popupThemeObserver = new MutationObserver(syncTheme)
  popupThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  opened.addEventListener('pagehide', returnFromPopup, { once: true })
  popupWindow = opened
  popupTarget.value = popupDocument.body
}
const sideConversationWindow = ref<TerminalFloatingWindowRect>(initialSideConversationWindowRect(sideConversationViewportSize()))
let sideConversationWindowGesture: SideConversationWindowGesture | null = null
const sideConversationWindowStyle = computed<Record<string, string>>(() => ({
  left: `${sideConversationWindow.value.left}px`,
  top: `${sideConversationWindow.value.top}px`,
  width: `${sideConversationWindow.value.width}px`,
  height: `${sideConversationWindow.value.height}px`,
}))
const sideConversationWindowWidthRange = computed(() => {
  const viewport = sideConversationViewportSize()
  const rect = sideConversationWindow.value
  return {
    minimum: clampTerminalWindowRect({ ...rect, width: 0 }, viewport).width,
    maximum: clampTerminalWindowRect({ ...rect, width: viewport.width }, viewport).width,
  }
})
const sideConversationWindowSizeText = computed(() => (
  `${sideConversationWindow.value.width} x ${sideConversationWindow.value.height} px`
))

onMounted(() => {
  resetSideConversationWindow()
  window.addEventListener('pagehide', closePopup)
  window.addEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.addEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.addEventListener('scroll', clampSideConversationWindowToViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', closePopup)
  closePopup()
  stopSideConversationWindowGesture()
  window.removeEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.removeEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.removeEventListener('scroll', clampSideConversationWindowToViewport)
})

function hydrateDraft(payload: Parameters<ThreadComposerExposed['hydrateDraft']>[0]): void {
  composerRef.value?.hydrateDraft(payload)
}

function hasUnsavedDraft(): boolean {
  return composerRef.value?.hasUnsavedDraft() ?? false
}

defineExpose({ hydrateDraft, hasUnsavedDraft })

function sideConversationViewportSize(): TerminalVisualViewport {
  if (typeof window === 'undefined') {
    return { width: 1200, height: 640, offsetLeft: 0, offsetTop: 0 }
  }
  const viewport = window.visualViewport
  return {
    width: Math.max(1, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(viewport?.height ?? window.innerHeight)),
    offsetLeft: Math.max(0, Math.round(viewport?.offsetLeft ?? 0)),
    offsetTop: Math.max(0, Math.round(viewport?.offsetTop ?? 0)),
  }
}

function resetSideConversationWindow(): void {
  sideConversationWindow.value = initialSideConversationWindowRect(sideConversationViewportSize())
}

function clampSideConversationWindowToViewport(): void {
  if (isMobile.value) return
  sideConversationWindow.value = clampTerminalWindowRect(sideConversationWindow.value, sideConversationViewportSize())
}

function onSideConversationViewportResize(): void {
  clampSideConversationWindowToViewport()
}

function onSideConversationHeaderPointerDown(event: PointerEvent): void {
  if (popupTarget.value) return
  if (isMobile.value || event.button !== 0 || !event.isPrimary) return
  const target = event.target
  if (target instanceof Element && target.closest('button')) return
  startSideConversationWindowGesture('drag', event)
}

function onSideConversationResizePointerDown(event: PointerEvent): void {
  if (isMobile.value || event.button !== 0 || !event.isPrimary) return
  startSideConversationWindowGesture('resize', event)
}

function onSideConversationResizeKeydown(event: KeyboardEvent): void {
  let width = sideConversationWindow.value.width
  let height = sideConversationWindow.value.height
  if (event.key === 'ArrowLeft') width -= SIDE_CONVERSATION_KEYBOARD_RESIZE_STEP
  else if (event.key === 'ArrowRight') width += SIDE_CONVERSATION_KEYBOARD_RESIZE_STEP
  else if (event.key === 'ArrowUp') height -= SIDE_CONVERSATION_KEYBOARD_RESIZE_STEP
  else if (event.key === 'ArrowDown') height += SIDE_CONVERSATION_KEYBOARD_RESIZE_STEP
  else return

  event.preventDefault()
  sideConversationWindow.value = clampTerminalWindowRect(
    { ...sideConversationWindow.value, width, height },
    sideConversationViewportSize(),
  )
}

function startSideConversationWindowGesture(kind: SideConversationWindowGesture['kind'], event: PointerEvent): void {
  event.preventDefault()
  stopSideConversationWindowGesture()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  sideConversationWindowGesture = {
    kind,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRect: { ...sideConversationWindow.value },
    target,
  }
  try {
    target.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is unavailable in some embedded browser contexts.
  }
  target.addEventListener('lostpointercapture', onSideConversationWindowPointerCaptureLost)
  window.addEventListener('pointermove', onSideConversationWindowPointerMove)
  window.addEventListener('pointerup', onSideConversationWindowPointerEnd)
  window.addEventListener('pointercancel', onSideConversationWindowPointerEnd)
  window.addEventListener('blur', stopSideConversationWindowGesture)
}

function onSideConversationWindowPointerMove(event: PointerEvent): void {
  const gesture = sideConversationWindowGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const deltaX = event.clientX - gesture.startClientX
  const deltaY = event.clientY - gesture.startClientY
  sideConversationWindow.value = clampTerminalWindowRect(
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
    sideConversationViewportSize(),
  )
}

function onSideConversationWindowPointerEnd(event: PointerEvent): void {
  if (!sideConversationWindowGesture || event.pointerId !== sideConversationWindowGesture.pointerId) return
  stopSideConversationWindowGesture()
}

function onSideConversationWindowPointerCaptureLost(event: PointerEvent): void {
  if (!sideConversationWindowGesture || event.pointerId !== sideConversationWindowGesture.pointerId) return
  stopSideConversationWindowGesture()
}

function stopSideConversationWindowGesture(): void {
  const gesture = sideConversationWindowGesture
  sideConversationWindowGesture = null
  if (typeof window === 'undefined') return
  window.removeEventListener('pointermove', onSideConversationWindowPointerMove)
  window.removeEventListener('pointerup', onSideConversationWindowPointerEnd)
  window.removeEventListener('pointercancel', onSideConversationWindowPointerEnd)
  window.removeEventListener('blur', stopSideConversationWindowGesture)
  if (!gesture) return
  gesture.target.removeEventListener('lostpointercapture', onSideConversationWindowPointerCaptureLost)
  if (gesture.target.hasPointerCapture(gesture.pointerId)) {
    gesture.target.releasePointerCapture(gesture.pointerId)
  }
}

watch(isMobile, (mobile) => {
  stopSideConversationWindowGesture()
  if (!mobile) resetSideConversationWindow()
})

</script>

<style scoped>
@reference "tailwindcss";

.side-conversation-host {
  @apply pointer-events-none fixed inset-0 z-[70] flex items-end justify-end p-4;
}

.side-conversation-panel {
  @apply pointer-events-auto fixed flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl;
}

.side-conversation-host--popup {
  padding: 0;
}

.side-conversation-host--popup .side-conversation-panel {
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 0;
}

.side-conversation-handle {
  @apply hidden;
}

.side-conversation-header {
  @apply flex h-12 shrink-0 cursor-move items-center gap-2 border-b border-zinc-200 px-3 select-none;
  touch-action: none;
}

.side-conversation-title {
  @apply min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900;
}

.side-conversation-icon-button {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 transition disabled:cursor-not-allowed disabled:opacity-50;
}

.side-conversation-icon-button {
  @apply bg-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900;
}

.side-conversation-icon-button :deep(svg) {
  @apply h-5 w-5;
}

.side-conversation-body {
  @apply min-h-0 flex-1 py-3;
}

.side-conversation-thread {
  @apply h-full;
}

.side-conversation-status {
  @apply flex h-full items-center justify-center px-4 text-sm text-zinc-500;
}

.side-conversation-error {
  @apply shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800;
}

.side-conversation-request {
  @apply max-h-[55%] shrink-0 overflow-y-auto border-t border-zinc-200 p-2 pb-8 pr-10;
}

.side-conversation-composer {
  @apply min-w-0 shrink-0 border-t border-zinc-200 p-2 pr-9;
}

.side-conversation-composer :deep(.queued-messages) {
  @apply max-h-28 overflow-y-auto;
}

.side-conversation-composer :deep(.thread-composer-shell) {
  @apply rounded-lg;
}

.side-conversation-composer :deep(.queued-messages-inner) {
  @apply rounded-t-lg;
}

.side-conversation-composer :deep(.thread-composer-shell--no-top-radius) {
  @apply rounded-t-none;
}

.side-conversation-resize-handle {
  @apply absolute bottom-0 right-0 z-10 flex h-8 w-8 cursor-nwse-resize items-end justify-end p-1 text-zinc-400 transition hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500;
  touch-action: none;
}

.side-conversation-resize-handle :deep(svg) {
  @apply h-3.5 w-3.5;
}

@media (max-width: 767px) {
  .side-conversation-host {
    @apply pointer-events-auto bg-black/40 p-0;
  }

  .side-conversation-panel {
    @apply static h-[min(78dvh,42rem)] w-full min-h-80 rounded-b-none rounded-t-lg border-x-0 border-b-0;
  }

  .side-conversation-handle {
    @apply mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-zinc-300;
  }

  .side-conversation-header {
    @apply cursor-default select-auto;
    touch-action: auto;
  }

  .side-conversation-request {
    @apply p-2;
  }

  .side-conversation-composer {
    @apply p-2;
  }
}
</style>
