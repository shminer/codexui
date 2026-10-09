<template>
  <div class="thread-resources-toolbar">
    <button class="thread-feature-icon" type="button" aria-label="Thread resources" title="Thread resources" :aria-expanded="open" @click="toggle"><IconTablerFolder /></button>
    <section v-if="open" class="thread-resources-panel" aria-label="Thread resources">
      <div class="thread-feature-modes" role="group" aria-label="Resource category">
        <button type="button" :aria-pressed="kind === 'attachment'" @click="kind = 'attachment'">Attachments</button>
        <button type="button" :aria-pressed="kind === 'file'" @click="kind = 'file'">Related files</button>
        <button class="thread-feature-icon" type="button" aria-label="Close resources" title="Close resources" @click="open = false"><IconTablerX /></button>
      </div>
      <p class="thread-feature-status">{{ resources.length }} resources · {{ complete ? 'History loaded' : 'Partial history' }}</p>
      <p v-if="error" class="thread-feature-error" role="alert">{{ error }}</p>
      <p v-if="unsupported" class="thread-feature-status">Loaded messages only</p>
      <div v-for="resource in visibleResources" :key="resource.key" class="thread-resource-row">
        <a class="thread-resource-name" :href="openUrl(resource)" :title="resource.path || resource.url" target="_blank" rel="noopener">{{ resource.label }}</a>
        <a class="thread-feature-icon" :href="downloadUrl(resource)" :download="resource.label" :target="resource.url ? '_blank' : undefined" rel="noopener" title="Download" aria-label="Download"><IconTablerArrowUp class="thread-resource-download" /></a>
        <button class="thread-feature-icon" type="button" title="Reference in composer" aria-label="Reference in composer" :disabled="busy" @click="reference(resource)"><IconTablerCopy /></button>
        <button class="thread-feature-icon" type="button" title="Source message" aria-label="Source message" :disabled="busy || !resource.itemId || !resource.turnId" @click="locate(resource)"><IconTablerArrowBackUp /></button>
      </div>
      <p v-if="!visibleResources.length" class="thread-feature-status">No resources</p>
      <button v-if="!unsupported && !complete" class="thread-feature-action" type="button" :disabled="busy" @click="loadHistory">{{ busy ? 'Loading...' : started ? 'Load more' : 'Load history' }}</button>
      <button class="thread-feature-action" type="button" :disabled="busy" @click="refresh">Refresh</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { UiMessage } from '../../types/codex'
import { limitThreadCommandOutputs } from '../../commandOutput'
import { getThreadResourcePage, getThreadResourceSource } from '../../api/codexGateway'
import { isNativeHistoryUnsupported } from '../../api/threadSearch'
import { mergeThreadResources, projectMessageResources, type UiThreadResource } from '../../threadResources'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import IconTablerX from '../icons/IconTablerX.vue'

const props = defineProps<{ threadId: string; cwd: string; messages: UiMessage[] }>()
const emit = defineEmits<{ reference: [resource: UiThreadResource]; locate: [value: { threadId: string; itemId: string; messages: UiMessage[] }] }>()
const open = ref(false)
const kind = ref<'attachment' | 'file'>('attachment')
const loaded = ref<UiThreadResource[]>([])
const history = ref<UiThreadResource[]>([])
const cursor = ref<string | null>(null)
const started = ref(false)
const complete = ref(false)
const unsupported = ref(false)
const busy = ref(false)
const error = ref('')
let generation = 0
const resources = computed(() => mergeThreadResources(loaded.value, history.value))
const visibleResources = computed(() => resources.value.filter((resource) => resource.kind === kind.value))

function openUrl(resource: UiThreadResource): string {
  return resource.path ? `/codex-local-open?path=${encodeURIComponent(resource.path)}` : resource.url
}
function downloadUrl(resource: UiThreadResource): string {
  return resource.path ? `/codex-local-file?path=${encodeURIComponent(resource.path)}` : resource.url
}
function updateLoaded(): void {
  if (open.value) loaded.value = projectMessageResources(props.messages, props.cwd)
}
function toggle(): void { open.value = !open.value; updateLoaded() }

async function loadHistory(): Promise<void> {
  if (busy.value || complete.value || unsupported.value) return
  const request = generation
  busy.value = true
  error.value = ''
  try {
    const page = await getThreadResourcePage(props.threadId, props.cwd, cursor.value)
    if (request !== generation) return
    if (page.nextCursor && page.nextCursor === cursor.value) throw new Error('Repeated resource cursor')
    history.value = mergeThreadResources(history.value, page.data)
    cursor.value = page.nextCursor
    started.value = true
    complete.value = !page.nextCursor
  } catch (failure) {
    if (request !== generation) return
    if (isNativeHistoryUnsupported(failure)) unsupported.value = true
    else error.value = failure instanceof Error ? failure.message : 'Failed to load resources'
  } finally {
    if (request === generation) busy.value = false
  }
}

async function reference(resource: UiThreadResource): Promise<void> {
  const request = generation
  busy.value = true
  error.value = ''
  try {
    if (resource.path) {
      const response = await fetch(downloadUrl(resource), { method: 'HEAD' })
      if (!response.ok) throw new Error('Resource file is missing or outside the allowed roots')
    }
    if (request === generation) emit('reference', resource)
  } catch (failure) {
    if (request === generation) error.value = failure instanceof Error ? failure.message : 'Reference failed'
  } finally { if (request === generation) busy.value = false }
}

async function locate(resource: UiThreadResource): Promise<void> {
  const request = generation
  busy.value = true
  error.value = ''
  try {
    const messages = props.messages.some((message) => message.id === resource.itemId)
      ? [] : limitThreadCommandOutputs(await getThreadResourceSource(props.threadId, resource.turnId, resource.itemId))
    if (request !== generation) return
    emit('locate', { threadId: props.threadId, itemId: resource.itemId, messages })
    open.value = false
  } catch (failure) {
    if (request === generation) error.value = failure instanceof Error ? failure.message : 'Source message is missing'
  } finally { if (request === generation) busy.value = false }
}

function refresh(): void {
  updateLoaded()
  history.value = []
  cursor.value = null
  started.value = false
  complete.value = false
  unsupported.value = false
  void loadHistory()
}
watch(() => props.messages.length, updateLoaded)
watch(() => props.threadId, () => {
  generation += 1
  open.value = false
  loaded.value = []
  history.value = []
  cursor.value = null
  started.value = complete.value = unsupported.value = busy.value = false
  error.value = ''
})
onBeforeUnmount(() => { generation += 1 })
</script>
