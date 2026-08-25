<template>
  <Teleport to="body">
    <div v-show="visible" class="side-conversation-host" @click.self="emit('minimize')">
      <section
        class="side-conversation-panel"
        role="dialog"
        :aria-modal="isMobile ? 'true' : undefined"
        :aria-labelledby="titleId"
        :style="isMobile ? undefined : sideConversationWindowStyle"
        @click.stop
      >
        <div class="side-conversation-handle" aria-hidden="true" />
        <header class="side-conversation-header" @pointerdown="onSideConversationHeaderPointerDown">
          <h2 :id="titleId" class="side-conversation-title">{{ t('Side conversation') }}</h2>
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
        <footer v-else class="side-conversation-composer">
          <textarea
            ref="inputRef"
            :value="draft"
            class="side-conversation-input"
            rows="2"
            :placeholder="t('Ask a side question...')"
            :aria-label="t('Side conversation message')"
            :disabled="isOpening || !threadId"
            @input="updateDraft"
            @keydown="onInputKeydown"
          />
          <button
            v-if="isTurnInProgress"
            class="side-conversation-action side-conversation-action--stop"
            type="button"
            :aria-label="t('Stop')"
            :title="t('Stop')"
            @click="emit('interrupt')"
          >
            <IconTablerPlayerStopFilled />
          </button>
          <button
            v-else
            class="side-conversation-action side-conversation-action--send"
            type="button"
            :aria-label="t('Send message')"
            :title="t('Send message')"
            :disabled="!canSend"
            @click="submit"
          >
            <IconTablerArrowUp />
          </button>
        </footer>
        <div
          v-if="!isMobile"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { UiLiveOverlay, UiMessage, UiServerRequest, UiServerRequestReply } from '../../types/codex'
import { useMobile } from '../../composables/useMobile'
import { useUiLanguage } from '../../composables/useUiLanguage'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerMaximize from '../icons/IconTablerMaximize.vue'
import IconTablerMinimize from '../icons/IconTablerMinimize.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import ThreadConversation from './ThreadConversation.vue'
import ThreadPendingRequestPanel from './ThreadPendingRequestPanel.vue'
import { shouldSubmitComposer } from './composerSubmitShortcut'
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

const props = defineProps<{
  threadId: string
  cwd: string
  messages: UiMessage[]
  pendingRequests: UiServerRequest[]
  liveOverlay: UiLiveOverlay | null
  error: string
  isOpening: boolean
  isTurnInProgress: boolean
  sendWithEnter?: boolean
  visible: boolean
  draft: string
}>()

const emit = defineEmits<{
  minimize: []
  end: []
  send: [text: string]
  'update:draft': [value: string]
  interrupt: []
  'respond-server-request': [reply: UiServerRequestReply]
}>()

const { isMobile } = useMobile()
const { t } = useUiLanguage()
const titleId = 'side-conversation-title'
const SIDE_CONVERSATION_KEYBOARD_RESIZE_STEP = 16
const inputRef = ref<HTMLTextAreaElement | null>(null)
const sideConversationWindow = ref<TerminalFloatingWindowRect>(initialSideConversationWindowRect(sideConversationViewportSize()))
let sideConversationWindowGesture: SideConversationWindowGesture | null = null
const canSend = computed(() => (
  props.threadId.length > 0
  && props.draft.trim().length > 0
  && !props.isOpening
  && !props.isTurnInProgress
))
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
  window.addEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.addEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.addEventListener('scroll', clampSideConversationWindowToViewport)
})

onBeforeUnmount(() => {
  stopSideConversationWindowGesture()
  window.removeEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.removeEventListener('resize', onSideConversationViewportResize)
  window.visualViewport?.removeEventListener('scroll', clampSideConversationWindowToViewport)
})

function submit(): void {
  if (!canSend.value) return
  emit('send', props.draft.trim())
  emit('update:draft', '')
}

function updateDraft(event: Event): void {
  emit('update:draft', (event.target as HTMLTextAreaElement).value)
}

function onInputKeydown(event: KeyboardEvent): void {
  if (!shouldSubmitComposer(event, props.sendWithEnter)) return
  event.preventDefault()
  submit()
}

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

watch(
  () => [props.threadId, props.visible] as const,
  ([threadId, visible]) => {
    if (!threadId || !visible) return
    void nextTick(() => inputRef.value?.focus())
  },
  { immediate: true },
)

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

.side-conversation-icon-button,
.side-conversation-action {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 transition disabled:cursor-not-allowed disabled:opacity-50;
}

.side-conversation-icon-button {
  @apply bg-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900;
}

.side-conversation-icon-button :deep(svg),
.side-conversation-action :deep(svg) {
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
  @apply flex shrink-0 items-end gap-2 border-t border-zinc-200 p-3 pr-10;
}

.side-conversation-input {
  @apply min-h-10 max-h-32 min-w-0 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-5 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:bg-zinc-100;
}

.side-conversation-action--send {
  @apply bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-300;
}

.side-conversation-action--stop {
  @apply bg-zinc-200 text-zinc-700 hover:bg-zinc-300;
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
    @apply p-3;
  }
}
</style>
