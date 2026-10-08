<template>
  <Teleport to="body">
    <div class="thread-history-overlay" @click.self="$emit('close')">
      <section ref="dialog" class="thread-history-dialog" role="dialog" aria-modal="true" :aria-label="thread.title" tabindex="-1" @keydown.esc.stop="$emit('close')" @keydown.tab="trapFocus">
        <header><strong>{{ thread.title }}</strong><button class="thread-feature-icon" type="button" aria-label="Close archived thread" title="Close archived thread" @click="$emit('close')"><IconTablerX /></button></header>
        <p v-if="error" class="thread-feature-error" role="alert">{{ error }} <button type="button" @click="detail ? loadOlder() : load()">Retry</button></p>
        <ThreadConversation v-if="detail" :messages="detail.messages" :pending-requests="[]" :live-overlay="null" :is-loading="loading"
          :active-thread-id="thread.id" :cwd="thread.cwd" :readonly="true" :has-more-persisted-above="detail.hasMoreOlder"
          :is-loading-persisted-above="loadingOlder" :load-earlier-messages="loadOlder" />
        <p v-else-if="loading" class="thread-feature-status">Loading...</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { getOlderThreadMessages, getThreadDetail } from '../../api/codexGateway'
import type { UiThread } from '../../types/codex'
import ThreadConversation from '../content/ThreadConversation.vue'
import IconTablerX from '../icons/IconTablerX.vue'

const props = defineProps<{ thread: UiThread }>()
defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const detail = ref<Awaited<ReturnType<typeof getThreadDetail>> | null>(null)
const loading = ref(false)
const loadingOlder = ref(false)
const error = ref('')
const previousFocus = typeof document === 'undefined' ? null : document.activeElement
let disposed = false

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await getThreadDetail(props.thread.id)
    if (!disposed) detail.value = result
  } catch (failure) {
    if (!disposed) error.value = failure instanceof Error ? failure.message : 'Failed to read archived thread'
  } finally { if (!disposed) loading.value = false }
}

async function loadOlder(): Promise<void> {
  if (!detail.value || loadingOlder.value) return
  const turnId = detail.value.messages.find((message) => message.turnId)?.turnId
  if (!turnId) return
  loadingOlder.value = true
  error.value = ''
  try {
    const page = await getOlderThreadMessages(props.thread.id, turnId)
    if (disposed || !detail.value) return
    const ids = new Set(detail.value.messages.map((message) => message.id))
    detail.value.messages = [...page.messages.filter((message) => !ids.has(message.id)), ...detail.value.messages]
    detail.value.hasMoreOlder = page.hasMoreOlder
  } catch (failure) {
    if (!disposed) error.value = failure instanceof Error ? failure.message : 'Failed to read older messages'
  } finally { if (!disposed) loadingOlder.value = false }
}

function trapFocus(event: KeyboardEvent): void {
  const elements = dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')
  if (!elements?.length) { event.preventDefault(); return }
  const target = event.shiftKey ? elements[elements.length - 1] : elements[0]
  if (document.activeElement === dialog.value || (event.shiftKey && document.activeElement === elements[0]) || (!event.shiftKey && document.activeElement === elements[elements.length - 1])) {
    event.preventDefault()
    target?.focus()
  }
}

onMounted(async () => { await nextTick(); if (disposed) return; dialog.value?.focus(); void load() })
onBeforeUnmount(() => { disposed = true; if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus() })
</script>
