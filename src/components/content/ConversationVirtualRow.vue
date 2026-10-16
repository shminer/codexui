<template>
  <div ref="element"><slot /></div>
</template>

<script setup lang="ts">
import { onUpdated, ref } from 'vue'
import { useDynamicScrollerItem } from 'vue-virtual-scroller'

const props = defineProps<{ item: { id: string }; index: number; active: boolean }>()
const emit = defineEmits<{ resize: [] }>()
const element = ref<HTMLElement>()
const { updateSize } = useDynamicScrollerItem(() => ({
  item: props.item,
  index: props.index,
  active: props.active,
  el: element,
  watchData: false,
  emitResize: true,
  onResize: () => {
    // A deferred observer entry can describe the previous contents of a pooled row.
    updateSize()
    emit('resize')
  },
}))

// Measure the patched slot as well as observer deliveries, including reused IDs.
onUpdated(updateSize)
</script>
