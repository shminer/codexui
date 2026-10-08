<template>
  <div class="thread-search-tools">
    <div class="thread-search-bar">
      <button class="thread-feature-icon" type="button" aria-label="Find in thread" title="Find in thread" :aria-pressed="open" @click="toggle"><IconTablerSearch /></button>
      <template v-if="open">
        <input ref="input" v-model="query" type="search" placeholder="Find in thread" aria-label="Find in thread" @keydown.escape="close" @keydown.enter.prevent="navigate(index + ($event.shiftKey ? -1 : 1))" />
        <span class="thread-feature-status" aria-live="polite">{{ hits.length ? index + 1 : 0 }} / {{ hits.length }}{{ nextCursor ? '+' : '' }}</span>
        <button class="thread-feature-icon" type="button" aria-label="Previous match" title="Previous match" :disabled="busy || !hits.length || index === 0" @click="navigate(index - 1)"><IconTablerChevronDown class="thread-search-previous" /></button>
        <button class="thread-feature-icon" type="button" aria-label="Next match" title="Next match" :disabled="busy || (!nextCursor && index + 1 >= hits.length)" @click="navigate(index + 1)"><IconTablerChevronDown /></button>
        <button class="thread-feature-icon" type="button" aria-label="Close search" title="Close search" @click="close"><IconTablerX /></button>
      </template>
    </div>
    <p v-if="open && busy" class="thread-feature-status" role="status">Searching...</p>
    <p v-if="open && unsupported" class="thread-feature-status" role="status">Thread search is not supported by this runtime <button type="button" @click="unsupported = false; load(true)">Retry</button></p>
    <p v-if="open && error" class="thread-feature-error" role="alert">{{ error }} <button type="button" @click="load(true)">Retry</button></p>
    <p v-if="open && selected" class="thread-search-snippet">{{ selected.snippet.slice(0, selected.snippetMatchRange.start) }}<mark>{{ selected.snippet.slice(selected.snippetMatchRange.start, selected.snippetMatchRange.end) }}</mark>{{ selected.snippet.slice(selected.snippetMatchRange.end) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getSearchTurnMessages, searchThreadOccurrences, type ThreadSearchOccurrence } from '../../api/codexGateway'
import { isNativeHistoryUnsupported } from '../../api/threadSearch'
import type { UiMessage } from '../../types/codex'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerX from '../icons/IconTablerX.vue'

const props = defineProps<{ threadId: string; messages: UiMessage[] }>()
const emit = defineEmits<{ locate: [value: { threadId: string; itemId: string; messages: UiMessage[] }]; clear: [] }>()
const open = ref(false)
const query = ref('')
const input = ref<HTMLInputElement | null>(null)
const hits = ref<ThreadSearchOccurrence[]>([])
const index = ref(0)
const nextCursor = ref<string | null>(null)
const busy = ref(false)
const error = ref('')
const unsupported = ref(false)
const selected = computed(() => hits.value[index.value])
let generation = 0
let navigation = 0
let timer: ReturnType<typeof setTimeout> | null = null
let cachedTurn: { id: string; messages: UiMessage[] } | null = null

async function toggle(): Promise<void> {
  if (open.value) return close()
  open.value = true
  await nextTick()
  input.value?.focus()
}

function close(): void {
  open.value = false
  query.value = ''
  generation += 1
  navigation += 1
  busy.value = false
  cachedTurn = null
  emit('clear')
}

async function load(reset: boolean): Promise<void> {
  const term = query.value.trim()
  if (!term || !props.threadId) return
  const request = generation
  busy.value = true
  error.value = ''
  try {
    const page = await searchThreadOccurrences(props.threadId, term, reset ? null : nextCursor.value)
    if (request !== generation) return
    if (!reset && page.nextCursor && page.nextCursor === nextCursor.value) throw new Error('Repeated occurrence cursor')
    const rows = reset ? page.data : [...hits.value, ...page.data]
    hits.value = [...new Map(rows.map((hit) => [JSON.stringify([hit.turnId, hit.itemId, hit.snippet, hit.snippetMatchRange]), hit])).values()]
    nextCursor.value = page.nextCursor
    if (reset) index.value = 0
  } catch (failure) {
    if (request !== generation) return
    if (isNativeHistoryUnsupported(failure)) unsupported.value = true
    else error.value = failure instanceof Error ? failure.message : 'Search failed'
  } finally {
    if (request === generation) busy.value = false
  }
  if (reset && request === generation && hits.value.length) await navigate(0)
}

async function navigate(next: number): Promise<void> {
  if (busy.value || next < 0) return
  const request = generation
  const nav = ++navigation
  if (next >= hits.value.length && nextCursor.value) await load(false)
  const hit = hits.value[next]
  if (!hit || request !== generation || nav !== navigation) return
  busy.value = true
  error.value = ''
  try {
    let messages: UiMessage[] = []
    if (!props.messages.some((message) => message.id === hit.itemId)) {
      if (cachedTurn?.id !== hit.turnId) {
        const page = await getSearchTurnMessages(props.threadId, hit.turnCursor)
        if (request !== generation || nav !== navigation) return
        cachedTurn = { id: hit.turnId, messages: page }
      }
      messages = cachedTurn.messages
      if (!messages.some((message) => message.id === hit.itemId && message.turnId === hit.turnId)) throw new Error('Search target is missing from its turn')
    }
    if (request !== generation || nav !== navigation) return
    index.value = next
    emit('locate', { threadId: props.threadId, itemId: hit.itemId, messages })
  } catch (failure) {
    if (request !== generation || nav !== navigation) return
    if (isNativeHistoryUnsupported(failure)) unsupported.value = true
    else error.value = failure instanceof Error ? failure.message : 'Failed to load search target'
  } finally {
    if (request === generation && nav === navigation) busy.value = false
  }
}

watch(query, () => {
  generation += 1
  navigation += 1
  if (timer) clearTimeout(timer)
  hits.value = []
  nextCursor.value = null
  index.value = 0
  error.value = ''
  busy.value = false
  emit('clear')
  if (query.value.trim() && !unsupported.value) timer = setTimeout(() => { void load(true) }, 220)
})
watch(() => props.threadId, () => { close(); unsupported.value = false })
onBeforeUnmount(() => { generation += 1; navigation += 1; if (timer) clearTimeout(timer) })
</script>
