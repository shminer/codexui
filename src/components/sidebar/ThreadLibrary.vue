<template>
  <section class="thread-library" aria-label="Archived threads">
    <p v-if="error" class="thread-feature-error" role="alert">{{ error }}</p>
    <div v-for="thread in threads" :key="thread.id" class="thread-library-row">
      <button class="thread-library-link" type="button" @click="$emit('select', thread.id)">
        <span>{{ thread.title }}</span>
        <time :datetime="thread.updatedAtIso">{{ new Date(thread.updatedAtIso).toLocaleDateString() }}</time>
      </button>
      <button class="thread-feature-icon" type="button" title="Restore thread" aria-label="Restore thread"
        :disabled="restoring.has(thread.id)" @click="restore(thread.id)"><IconTablerArchive /></button>
    </div>
    <p v-if="!loading && !error && !threads.length" class="thread-feature-status">No archived threads</p>
    <button v-if="nextCursor || error" class="thread-feature-action" type="button" :disabled="loading" @click="load()">{{ error ? 'Retry' : 'Load more' }}</button>
    <p v-if="loading" class="thread-feature-status" role="status">Loading...</p>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getThreadGroupsPage, unarchiveThread } from '../../api/codexGateway'
import type { UiThread } from '../../types/codex'
import IconTablerArchive from '../icons/IconTablerArchive.vue'

const emit = defineEmits<{ select: [threadId: string]; restored: [] }>()
const threads = ref<UiThread[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const restoring = ref(new Set<string>())
let disposed = false

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const page = await getThreadGroupsPage(nextCursor.value, 50, true)
    if (disposed) return
    threads.value = [...new Map([...threads.value, ...page.groups.flatMap((group) => group.threads)].map((thread) => [thread.id, thread])).values()]
    nextCursor.value = page.nextCursor
  } catch (failure) {
    if (!disposed) error.value = failure instanceof Error ? failure.message : 'Failed to load archived threads'
  } finally {
    if (!disposed) loading.value = false
  }
}

async function restore(threadId: string): Promise<void> {
  if (restoring.value.has(threadId)) return
  restoring.value.add(threadId)
  error.value = ''
  try {
    await unarchiveThread(threadId)
    if (disposed) return
    threads.value = threads.value.filter((thread) => thread.id !== threadId)
    emit('restored')
  } catch (failure) {
    if (!disposed) error.value = failure instanceof Error ? failure.message : 'Failed to restore thread'
  } finally {
    restoring.value.delete(threadId)
  }
}

onMounted(() => { void load() })
onBeforeUnmount(() => { disposed = true })
</script>
