<template>
  <Teleport to="body">
    <div class="side-conversation-host" @click.self="emit('close')">
      <section
        class="side-conversation-panel"
        role="dialog"
        :aria-modal="isMobile ? 'true' : undefined"
        :aria-labelledby="titleId"
        @click.stop
      >
        <div class="side-conversation-handle" aria-hidden="true" />
        <header class="side-conversation-header">
          <h2 :id="titleId" class="side-conversation-title">{{ t('Side conversation') }}</h2>
          <button
            class="side-conversation-icon-button"
            type="button"
            :aria-label="t('Close side conversation')"
            :title="t('Close side conversation')"
            :disabled="isClosing"
            @click="emit('close')"
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
            v-model="draft"
            class="side-conversation-input"
            rows="2"
            :placeholder="t('Ask a side question...')"
            :aria-label="t('Side conversation message')"
            :disabled="isOpening || isClosing || !threadId"
            @keydown="onInputKeydown"
          />
          <button
            v-if="isTurnInProgress"
            class="side-conversation-action side-conversation-action--stop"
            type="button"
            :aria-label="t('Stop')"
            :title="t('Stop')"
            :disabled="isClosing"
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
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { UiLiveOverlay, UiMessage, UiServerRequest, UiServerRequestReply } from '../../types/codex'
import { useMobile } from '../../composables/useMobile'
import { useUiLanguage } from '../../composables/useUiLanguage'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import ThreadConversation from './ThreadConversation.vue'
import ThreadPendingRequestPanel from './ThreadPendingRequestPanel.vue'

const props = defineProps<{
  threadId: string
  cwd: string
  messages: UiMessage[]
  pendingRequests: UiServerRequest[]
  liveOverlay: UiLiveOverlay | null
  error: string
  isOpening: boolean
  isClosing: boolean
  isTurnInProgress: boolean
}>()

const emit = defineEmits<{
  close: []
  send: [text: string]
  interrupt: []
  'respond-server-request': [reply: UiServerRequestReply]
}>()

const { isMobile } = useMobile()
const { t } = useUiLanguage()
const titleId = 'side-conversation-title'
const inputRef = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
const canSend = computed(() => (
  props.threadId.length > 0
  && draft.value.trim().length > 0
  && !props.isOpening
  && !props.isClosing
  && !props.isTurnInProgress
))

function submit(): void {
  if (!canSend.value) return
  emit('send', draft.value.trim())
  draft.value = ''
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

watch(
  () => props.threadId,
  (threadId) => {
    if (!threadId) return
    void nextTick(() => inputRef.value?.focus())
  },
  { immediate: true },
)
</script>

<style scoped>
@reference "tailwindcss";

.side-conversation-host {
  @apply pointer-events-none fixed inset-0 z-[70] flex items-end justify-end p-4;
}

.side-conversation-panel {
  @apply pointer-events-auto flex h-[min(70dvh,40rem)] w-[min(26rem,calc(100vw-2rem))] min-h-80 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl;
}

.side-conversation-handle {
  @apply hidden;
}

.side-conversation-header {
  @apply flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 px-3;
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
  @apply max-h-[55%] shrink-0 overflow-y-auto border-t border-zinc-200 p-2;
}

.side-conversation-composer {
  @apply flex shrink-0 items-end gap-2 border-t border-zinc-200 p-3;
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

@media (max-width: 767px) {
  .side-conversation-host {
    @apply pointer-events-auto bg-black/40 p-0;
  }

  .side-conversation-panel {
    @apply h-[min(78dvh,42rem)] w-full min-h-80 rounded-b-none rounded-t-lg border-x-0 border-b-0;
  }

  .side-conversation-handle {
    @apply mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-zinc-300;
  }
}
</style>
