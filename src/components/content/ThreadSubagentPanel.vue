<template>
  <button
    v-if="agents.length > 0"
    type="button"
    class="subagent-mobile-trigger"
    :aria-label="`Show ${agents.length} agents`"
    :title="`Show ${agents.length} agents`"
    @click="mobileSheetOpen = true"
  >
    <IconTablerBolt class="subagent-mobile-trigger-icon" />
    <span>{{ agents.length }}</span>
  </button>

  <Teleport to="body" :disabled="!mobileSheetOpen">
    <aside
      v-if="agents.length > 0"
      class="subagent-panel"
      :class="{ 'is-mobile-open': mobileSheetOpen }"
      @click.self="mobileSheetOpen = false"
    >
      <section class="subagent-panel-surface" @click.stop>
        <div v-if="mobileSheetOpen" class="subagent-sheet-handle" aria-hidden="true" />
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
          <span v-if="!selectedAgent && !mobileSheetOpen" class="subagent-panel-count">{{ agents.length }}</span>
          <button
            v-if="mobileSheetOpen"
            type="button"
            class="subagent-icon-button"
            aria-label="Close agents"
            title="Close agents"
            @click="mobileSheetOpen = false"
          >
            <IconTablerX />
          </button>
        </header>

        <div v-if="!selectedAgent" class="subagent-list">
          <button
            v-for="(agent, index) in agents"
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
        </div>

        <template v-else>
          <p v-if="selectedAgent.prompt" class="subagent-detail-prompt">{{ selectedAgent.prompt }}</p>
          <p v-if="loadingThreadId === selectedAgent.threadId" class="subagent-detail-loading">Loading agent thread...</p>
          <p v-if="detailError" class="subagent-detail-error">{{ detailError }}</p>
          <ThreadConversation
            v-if="selectedDetail"
            class="subagent-conversation"
            :messages="selectedDetail.messages"
            :pending-requests="[]"
            :live-overlay="selectedLiveOverlay"
            :is-loading="false"
            :active-thread-id="selectedAgent.threadId"
            :cwd="cwd"
            :readonly="true"
          />
        </template>
      </section>
    </aside>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getThreadDetail, type UiSubagent } from '../../api/codexGateway'
import type { UiLiveOverlay } from '../../types/codex'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerChevronLeft from '../icons/IconTablerChevronLeft.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import ThreadConversation from './ThreadConversation.vue'

const props = defineProps<{
  agents: UiSubagent[]
  cwd: string
  liveOverlayForThread: (threadId: string) => UiLiveOverlay | null
}>()

const mobileSheetOpen = ref(false)
const selectedThreadId = ref('')
const loadingThreadId = ref('')
const detailError = ref('')
const selectedDetail = ref<Awaited<ReturnType<typeof getThreadDetail>> | null>(null)
let detailRequestId = 0

const selectedAgent = computed(() => props.agents.find((agent) => agent.threadId === selectedThreadId.value) ?? null)
const selectedAgentIndex = computed(() => props.agents.findIndex((agent) => agent.threadId === selectedThreadId.value))
const selectedLiveOverlay = computed(() => selectedAgent.value ? props.liveOverlayForThread(selectedAgent.value.threadId) : null)

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'errored' || status === 'failed' || status === 'shutdown' || status === 'notFound'
}

async function selectAgent(threadId: string): Promise<void> {
  if (!props.agents.some((agent) => agent.threadId === threadId)) return
  if (selectedThreadId.value !== threadId) selectedDetail.value = null
  selectedThreadId.value = threadId
  detailError.value = ''
  if (selectedDetail.value) return

  const requestId = ++detailRequestId
  loadingThreadId.value = threadId
  try {
    const detail = await getThreadDetail(threadId)
    if (requestId !== detailRequestId || selectedThreadId.value !== threadId) return
    selectedDetail.value = detail
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
  selectedThreadId.value = ''
  detailError.value = ''
  loadingThreadId.value = ''
  selectedDetail.value = null
}

watch(
  () => props.agents,
  (agents) => {
    if (selectedThreadId.value && !agents.some((agent) => agent.threadId === selectedThreadId.value)) {
      closeDetail()
    }
  },
)

watch(
  () => selectedAgent.value?.status,
  (status, previousStatus) => {
    const threadId = selectedAgent.value?.threadId
    if (!threadId || !isTerminalStatus(status) || isTerminalStatus(previousStatus)) return
    selectedDetail.value = null
    void selectAgent(threadId)
  },
)
</script>

<style scoped>
@reference "tailwindcss";

.subagent-panel {
  @apply hidden min-h-0 w-80 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white;
}

.subagent-panel-surface {
  @apply flex min-h-0 flex-1 flex-col;
}

.subagent-mobile-trigger {
  @apply fixed bottom-20 right-4 z-30 hidden h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-lg shadow-slate-900/10;
}

.subagent-mobile-trigger-icon,
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

.subagent-sheet-handle {
  @apply mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300;
}

@media (min-width: 768px) {
  .subagent-panel {
    @apply flex;
  }
}

@media (max-width: 767px) {
  .subagent-mobile-trigger {
    @apply inline-flex;
  }

  .subagent-panel.is-mobile-open {
    @apply fixed inset-0 z-[270] flex w-full items-end rounded-none border-0 bg-slate-950/40;
  }

  .subagent-panel.is-mobile-open .subagent-panel-surface {
    @apply h-[min(78dvh,42rem)] w-full rounded-t-lg bg-white shadow-2xl;
  }
}

:global(:root.dark) .subagent-panel {
  @apply border-slate-700 bg-slate-900;
}

:global(:root.dark) .subagent-panel-header,
:global(:root.dark) .subagent-detail-prompt {
  @apply border-slate-700;
}

:global(:root.dark) .subagent-panel-title,
:global(:root.dark) .subagent-row-title {
  @apply text-slate-100;
}

:global(:root.dark) .subagent-panel-count,
:global(:root.dark) .subagent-row-status,
:global(:root.dark) .subagent-row-preview,
:global(:root.dark) .subagent-detail-status,
:global(:root.dark) .subagent-detail-prompt,
:global(:root.dark) .subagent-detail-loading {
  @apply text-slate-400;
}

:global(:root.dark) .subagent-row:hover,
:global(:root.dark) .subagent-icon-button:hover {
  @apply border-slate-700 bg-slate-800 text-slate-100;
}

:global(:root.dark) .subagent-mobile-trigger,
:global(:root.dark) .subagent-panel.is-mobile-open .subagent-panel-surface {
  @apply border-slate-700 bg-slate-900 text-slate-100;
}

:global(:root.dark) .subagent-sheet-handle {
  @apply bg-slate-600;
}
</style>
