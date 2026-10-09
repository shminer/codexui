<template>
  <div class="command-output-detail">
    <div class="command-output-tools">
      <span v-if="totalLength > text.length" class="command-output-range">{{ offset + 1 }}-{{ offset + text.length }} / {{ totalLength }}</span>
      <button v-if="canReadHistory && offset > 0" type="button" :disabled="loading" title="Earlier output" aria-label="Earlier output" @click="loadPage(Math.max(0, offset - MAX_COMMAND_OUTPUT_CHARS))"><IconTablerChevronLeft /></button>
      <button v-if="canReadHistory && offset + text.length < totalLength" type="button" :disabled="loading" title="Later output" aria-label="Later output" @click="loadPage(offset + text.length)"><IconTablerChevronRight /></button>
      <button v-if="detail" type="button" :disabled="loading" title="Latest output" aria-label="Latest output" @click="resetDetail"><IconTablerArrowUp /></button>
      <button type="button" :disabled="copying || !canCopyFull" :title="copied ? 'Copied' : 'Copy full output'" :aria-label="copied ? 'Copied' : 'Copy full output'" @click="copyFullOutput"><IconTablerCopy /></button>
    </div>
    <p v-if="error" class="command-output-error" role="status">{{ error }}</p>
    <pre class="cmd-output" :class="{ 'cmd-output-condensed': condensed }" v-text="text || '(no output)'" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ThreadHistorySource, UiMessage } from '../../types/codex'
import { getThreadCommandOutputPage, getThreadResourceSource } from '../../api/codexGateway'
import { MAX_COMMAND_OUTPUT_CHARS, commandOutputPage, limitCommandExecutionOutput } from '../../commandOutput'
import { copyTextToClipboard } from '../../utils/clipboard'
import IconTablerChevronLeft from '../icons/IconTablerChevronLeft.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'

const props = withDefaults(defineProps<{ threadId: string; message: UiMessage; condensed?: boolean; recoverableHistory?: boolean; historySource?: ThreadHistorySource }>(), { recoverableHistory: true })
const detail = ref<Awaited<ReturnType<typeof getThreadCommandOutputPage>> | null>(null)
const loading = ref(false)
const copying = ref(false)
const copied = ref(false)
const error = ref('')
let generation = 0
let copyGeneration = 0
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const preview = computed(() => props.message.commandExecution ? limitCommandExecutionOutput(props.message.commandExecution) : null)
const text = computed(() => detail.value?.text ?? preview.value?.aggregatedOutput ?? '')
const offset = computed(() => detail.value?.offset ?? preview.value?.outputOffset ?? 0)
const totalLength = computed(() => detail.value?.totalLength ?? preview.value?.outputTotalLength ?? text.value.length)
const canReadSource = computed(() => props.recoverableHistory !== false && Boolean(props.threadId && props.message.turnId))
const canReadHistory = computed(() => preview.value?.status !== 'inProgress' && (!props.message.commandExecution?.outputTruncated || canReadSource.value))
const canCopyFull = computed(() => !props.message.commandExecution?.outputTruncated || (canReadHistory.value && canReadSource.value))

function resetDetail(): void {
  generation += 1
  copyGeneration += 1
  detail.value = null
  loading.value = false
  copying.value = false
  copied.value = false
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = null
  error.value = ''
}

async function loadPage(pageOffset: number): Promise<void> {
  if (!canReadHistory.value || loading.value) return
  const requestGeneration = ++generation
  loading.value = true
  error.value = ''
  try {
    const command = props.message.commandExecution
    const page = command && !command.outputTruncated
      ? commandOutputPage(command.aggregatedOutput, pageOffset, MAX_COMMAND_OUTPUT_CHARS)
      : await getThreadCommandOutputPage(props.threadId, props.message.turnId!, props.message.id, pageOffset, MAX_COMMAND_OUTPUT_CHARS, props.historySource)
    if (requestGeneration === generation) detail.value = page
  } catch (cause) {
    if (requestGeneration === generation) error.value = cause instanceof Error ? cause.message : 'Failed to load output.'
  } finally {
    if (requestGeneration === generation) loading.value = false
  }
}

async function copyFullOutput(): Promise<void> {
  if (!canCopyFull.value || copying.value) return
  const requestGeneration = ++copyGeneration
  const messageId = props.message.id
  copying.value = true
  error.value = ''
  try {
    let fullText = props.message.commandExecution?.aggregatedOutput ?? ''
    if (props.message.commandExecution?.outputTruncated) {
      const messages = await getThreadResourceSource(props.threadId, props.message.turnId!, messageId, props.historySource)
      const command = messages.find((message) => message.id === messageId)?.commandExecution
      if (!command || command.outputTruncated) throw new Error('Full command output is not available.')
      fullText = command.aggregatedOutput
    }
    if (requestGeneration !== copyGeneration) return
    await copyTextToClipboard(fullText)
    if (requestGeneration !== copyGeneration) return
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false; copiedTimer = null }, 1800)
  } catch (cause) {
    if (requestGeneration === copyGeneration) error.value = cause instanceof Error ? cause.message : 'Failed to copy output.'
  } finally {
    if (requestGeneration === copyGeneration) copying.value = false
  }
}

watch(() => [props.threadId, props.message.id, props.recoverableHistory, props.historySource], () => {
  resetDetail()
  copied.value = false
  if (copiedTimer) clearTimeout(copiedTimer)
})
onBeforeUnmount(() => {
  generation += 1
  copyGeneration += 1
  copying.value = false
  detail.value = null
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.command-output-detail { min-width: 0; background: #18181b; color: #e4e4e7; }
.command-output-tools { display: flex; justify-content: flex-end; align-items: center; gap: 4px; min-height: 30px; padding: 2px 6px; }
.command-output-range { margin-right: auto; font-size: 11px; color: #a1a1aa; }
.command-output-tools button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 32px; width: 32px; height: 32px; border-radius: 4px; color: #d4d4d8; }
.command-output-tools button:hover { background: #3f3f46; }
.command-output-tools button:disabled { opacity: 0.4; }
.command-output-tools svg { width: 16px; height: 16px; }
.command-output-error { padding: 4px 12px; color: #fda4af; font-size: 12px; }
.cmd-output { margin: 0; padding: 8px 12px; font: 12px/1.5 monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; }
.cmd-output-condensed { max-height: 144px; }
</style>
