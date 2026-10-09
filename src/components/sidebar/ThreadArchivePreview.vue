<template>
  <Teleport to="body">
    <div class="thread-history-overlay" @click.self="$emit('close')">
      <section ref="dialog" class="thread-history-dialog" role="dialog" aria-modal="true" :aria-label="thread.title" tabindex="-1" @keydown.esc.stop="$emit('close')" @keydown.tab="trapFocus">
        <header><strong>{{ thread.title }}</strong><button class="thread-feature-icon" type="button" :aria-label="t('Close archived conversation')" :title="t('Close archived conversation')" @click="$emit('close')"><IconTablerX /></button></header>
        <p v-if="error" class="thread-feature-error" role="alert">{{ error }} <button type="button" @click="retryLoad">{{ t('Retry') }}</button></p>
        <ThreadConversation v-if="detail" :messages="detail.messages" :pending-requests="[]" :live-overlay="null" :is-loading="loading"
          :active-thread-id="thread.id" :cwd="thread.cwd" :readonly="true" :has-more-persisted-above="detail.hasMoreOlder"
          :is-loading-persisted-above="loadingOlder" :load-earlier-messages="loadOlder"
          :has-more-persisted-below="detail.hasMoreNewer" :is-loading-persisted-below="loadingNewer"
          :load-later-messages="loadNewer" :load-latest-messages="loadLatest" />
        <p v-else-if="loading" class="thread-feature-status">{{ t('Loading...') }}</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useThreadHistoryWindow } from '../../composables/useThreadHistoryWindow'
import { useUiLanguage } from '../../composables/useUiLanguage'
import type { UiThread } from '../../types/codex'
import ThreadConversation from '../content/ThreadConversation.vue'
import IconTablerX from '../icons/IconTablerX.vue'

const props = defineProps<{ thread: UiThread }>()
const { t } = useUiLanguage()
defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const { detail, loading, loadingOlder, loadingNewer, error, loadLatest, loadOlder, loadNewer, retry } = useThreadHistoryWindow(computed(() => props.thread.id))
const previousFocus = typeof document === 'undefined' ? null : document.activeElement
let disposed = false

async function load(): Promise<void> {
  try { await loadLatest() } catch { /* The history window exposes the error. */ }
}

async function retryLoad(): Promise<void> {
  try { await retry() } catch { /* Preserve the current reading window. */ }
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
