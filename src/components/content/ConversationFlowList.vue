<template>
  <div ref="element" class="conversation-flow-list">
    <slot name="before" />
    <div ref="content" class="conversation-flow-content">
      <template v-for="(item, index) in items" :key="item.id">
        <slot :item="item" :index="index" :active="true" />
      </template>
    </div>
    <slot name="after" />
  </div>
</template>

<script setup lang="ts" generic="T extends { id: string }">
import { ref, watch } from 'vue'

const props = defineProps<{ items: T[]; ownerDocument?: Document }>()
const emit = defineEmits<{ resize: [] }>()
const element = ref<HTMLElement>()
const content = ref<HTMLElement>()

// Only following the latest output needs size notifications; row layout is native.
watch(() => [content.value, props.ownerDocument] as const, ([body], _previous, onCleanup) => {
  const owner = body?.ownerDocument.defaultView
  if (!body || !owner) return
  const observer = new owner.ResizeObserver(() => emit('resize'))
  observer.observe(body)
  if (element.value) observer.observe(element.value)
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })

function scrollToItem(index: number, options?: { align?: 'start' | 'center' | 'end' }): void {
  const row = content.value?.children[index] as HTMLElement | undefined
  const container = element.value
  if (!row || !container) return
  const bounds = row.getBoundingClientRect()
  const offset = bounds.top - container.getBoundingClientRect().top
  const alignment = options?.align === 'end' ? container.clientHeight - bounds.height
    : options?.align === 'center' ? (container.clientHeight - bounds.height) / 2 : 0
  container.scrollTop += offset - alignment
}

defineExpose({ scrollToItem })
</script>

<style scoped>
.conversation-flow-content {
  display: flow-root;
}
</style>
