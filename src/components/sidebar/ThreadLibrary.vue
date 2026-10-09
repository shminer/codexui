<template>
  <section class="thread-library" :aria-label="t(query.trim() ? 'Search results' : 'Archived Conversations')">
    <p v-if="unsupported && query.trim()" class="thread-feature-status" role="status">{{ t('Title search only') }} <button type="button" @click="unsupported = false; load()">{{ t('Retry full-text search') }}</button></p>
    <p v-if="loadingMetadata" class="thread-feature-status" role="status">{{ t('Loading titles...') }}</p>
    <p v-if="metadataError" class="thread-feature-error" role="alert">{{ metadataError }} <button type="button" @click="ensureMetadata()">{{ t('Retry') }}</button></p>
    <p v-if="error" class="thread-feature-error" role="alert">{{ error }}</p>
    <p v-if="actionError" class="thread-feature-error" role="alert">{{ actionError }}</p>
    <div v-for="thread in visibleThreads" :key="thread.id" class="thread-library-entry">
      <div class="thread-library-row" :aria-busy="pending.has(thread.id)">
        <button class="thread-library-link" type="button" :disabled="pending.has(thread.id)" @click="archived ? previewThread = thread : $emit('select', thread)">
          <span>{{ thread.title }}</span>
          <time :datetime="thread.updatedAtIso">{{ new Date(thread.updatedAtIso).toLocaleDateString(uiLanguage) }}</time>
          <small v-if="thread.inProgress">{{ t('Running') }}</small>
        </button>
        <button v-if="archived" class="thread-feature-icon" type="button" :title="t('Restore conversation')" :aria-label="t('Restore conversation')"
          :disabled="pending.has(thread.id)" @click="restore(thread.id)"><IconTablerArchive /></button>
        <button v-if="archived" class="thread-feature-icon thread-library-delete" type="button" :title="t('Delete conversation')" :aria-label="t('Delete conversation')"
          :disabled="pending.has(thread.id)" :aria-expanded="confirmation?.id === thread.id" @click="requestDelete(thread)"><IconTablerTrash /></button>
      </div>
      <div v-if="archived && confirmation?.id === thread.id" class="thread-library-confirmation" @keydown.esc.stop="!pending.has(thread.id) && cancelDelete()">
        <p>{{ t('Permanently delete "{title}"? This action is permanent. Project files will be kept.', { title: thread.title }) }}</p>
        <div class="thread-library-confirmation-actions">
          <button class="thread-library-confirm-delete" type="button" :disabled="pending.has(thread.id)" @click="confirmDelete()">{{ t(pending.get(thread.id) === 'delete' ? 'Deleting...' : 'Delete') }}</button>
          <button class="thread-feature-action" type="button" :disabled="pending.has(thread.id)" @click="cancelDelete()">{{ t('Cancel') }}</button>
        </div>
      </div>
    </div>
    <p v-if="!loading && !loadingMetadata && !error && !visibleThreads.length" class="thread-feature-status">{{ t(query.trim() ? 'No results' : 'No archived conversations') }}</p>
    <button v-if="nextCursor || error" class="thread-feature-action" type="button" :disabled="loading" @click="load()">{{ t(error ? 'Retry' : 'Load more') }}</button>
    <p v-if="loading" class="thread-feature-status" role="status">{{ t('Loading...') }}</p>
    <ThreadArchivePreview v-if="previewThread" :key="previewThread.id" :thread="previewThread" @close="previewThread = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getThreadGroupsPage, searchThreads } from '../../api/codexGateway'
import { isNativeHistoryUnsupported, titleMatchRank } from '../../api/threadSearch'
import { useUiLanguage } from '../../composables/useUiLanguage'
import { useArchivedThreadActions } from './useArchivedThreadActions'
import type { UiThread } from '../../types/codex'
import IconTablerArchive from '../icons/IconTablerArchive.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import ThreadArchivePreview from './ThreadArchivePreview.vue'

const emit = defineEmits<{ select: [thread: UiThread]; restored: []; deleted: [threadId: string] }>()
const { t, uiLanguage } = useUiLanguage()
const props = withDefaults(defineProps<{
  archived?: boolean
  query?: string
  activeThreads?: UiThread[]
  loadActiveMetadata?: () => Promise<void>
}>(), { archived: true, query: '', activeThreads: () => [] })
const threads = ref<UiThread[]>([])
const previewThread = ref<UiThread | null>(null)
const nativeThreads = ref<UiThread[]>([])
const nextCursor = ref<string | null>(null)
const titleCursor = ref<string | null>(null)
let titlesStarted = false
let titlesComplete = false
const unsupported = ref(false)
const loadingMetadata = ref(false)
const metadataError = ref('')
const loading = ref(false)
const error = ref('')
const removedIds = ref(new Set<string>())
const { pending, confirmation, error: actionError, requestDelete, cancelDelete, confirmDelete, restore } = useArchivedThreadActions((threadId, action) => {
  threads.value = threads.value.filter((thread) => thread.id !== threadId)
  nativeThreads.value = nativeThreads.value.filter((thread) => thread.id !== threadId)
  removedIds.value.add(threadId)
  if (previewThread.value?.id === threadId) previewThread.value = null
  if (action === 'restore') emit('restored')
  else emit('deleted', threadId)
})
let disposed = false
let generation = 0
let timer: ReturnType<typeof setTimeout> | null = null
let metadataTask: Promise<void> | null = null
const visibleThreads = computed(() => {
  const query = props.query.trim()
  const titles = props.archived ? threads.value : props.activeThreads
  if (!query) return titles.filter((thread) => !removedIds.value.has(thread.id))
  const ranked = new Map<string, { thread: UiThread; rank: number }>()
  for (const thread of nativeThreads.value) ranked.set(thread.id, { thread, rank: 0 })
  for (const thread of titles) {
    if (ranked.has(thread.id)) continue
    const rank = titleMatchRank(thread.title, query)
    if (rank < 2) ranked.set(thread.id, { thread, rank })
  }
  return [...ranked.values()].filter(({ thread }) => !removedIds.value.has(thread.id))
    .sort((a, b) => a.rank - b.rank || Date.parse(b.thread.updatedAtIso) - Date.parse(a.thread.updatedAtIso)).map(({ thread }) => thread)
})

async function ensureMetadata(): Promise<void> {
  if (metadataTask) return metadataTask
  loadingMetadata.value = true
  metadataError.value = ''
  metadataTask = (async () => {
    try {
      if (!props.archived) await props.loadActiveMetadata?.()
      else while (!titlesComplete && !disposed && props.query.trim()) await loadTitlePage()
    } catch (failure) {
      if (!disposed) metadataError.value = failure instanceof Error ? failure.message : t('Failed to load titles')
    } finally {
      metadataTask = null
      if (!disposed) loadingMetadata.value = false
    }
  })()
  return metadataTask
}

async function loadTitlePage(): Promise<void> {
  const page = await getThreadGroupsPage(titleCursor.value, 50, props.archived)
  if (disposed) return
  threads.value = [...new Map([...threads.value, ...page.groups.flatMap((group) => group.threads)]
    .filter((thread) => !removedIds.value.has(thread.id)).map((thread) => [thread.id, thread])).values()]
  if (titlesStarted && page.nextCursor && page.nextCursor === titleCursor.value) throw new Error('Repeated title cursor')
  titlesStarted = true
  titleCursor.value = page.nextCursor
  titlesComplete = !page.nextCursor
  if (!props.query.trim()) nextCursor.value = page.nextCursor
}

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  const requestGeneration = generation
  const query = props.query.trim()
  try {
    if (!query) await loadTitlePage()
    else if (!unsupported.value) {
      const page = await searchThreads(query, 50, nextCursor.value, props.archived)
      if (disposed || requestGeneration !== generation) return
      nativeThreads.value = [...new Map([...nativeThreads.value, ...page.threads]
        .filter((thread) => !removedIds.value.has(thread.id)).map((thread) => [thread.id, thread])).values()]
      if (page.nextCursor && page.nextCursor === nextCursor.value) throw new Error('Repeated search cursor')
      nextCursor.value = page.nextCursor
    }
  } catch (failure) {
    if (disposed || requestGeneration !== generation) return
    if (query && isNativeHistoryUnsupported(failure)) { unsupported.value = true; nextCursor.value = null }
    else error.value = failure instanceof Error ? failure.message : t('Failed to load threads')
  } finally {
    if (!disposed && requestGeneration === generation) loading.value = false
  }
}

watch(() => props.query, () => {
  cancelDelete()
  generation += 1
  if (timer) clearTimeout(timer)
  nativeThreads.value = []
  nextCursor.value = props.query.trim() ? null : titleCursor.value
  error.value = ''
  loading.value = false
  if (props.query.trim()) {
    timer = setTimeout(() => { void load(); void ensureMetadata() }, 220)
  } else if (!titlesStarted) void load()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; generation += 1; if (timer) clearTimeout(timer) })
</script>
