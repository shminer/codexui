<template>
  <div class="sidebar-thread-controls">
    <button
      class="sidebar-thread-controls-button"
      type="button"
      :aria-label="isSidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar')"
      :title="isSidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar')"
      @click="$emit('toggle-sidebar')"
    >
      <IconTablerLayoutSidebarFilled v-if="isSidebarCollapsed" class="sidebar-thread-controls-icon" />
      <IconTablerLayoutSidebar v-else class="sidebar-thread-controls-icon" />
    </button>

    <slot />

    <button
      v-if="showNewThreadButton"
      class="sidebar-thread-controls-button"
      type="button"
      :aria-label="t('Start new thread')"
      :title="t('Start new thread')"
      @click="$emit('start-new-thread')"
    >
      <IconTablerFilePencil class="sidebar-thread-controls-icon" />
    </button>

    <button
      v-if="showFileBrowserButton"
      class="sidebar-thread-controls-button"
      type="button"
      :aria-label="t('Browse files')"
      :title="t('Browse files')"
      :disabled="fileBrowserDisabled"
      @click="$emit('browse-files')"
    >
      <IconTablerFolderOpen class="sidebar-thread-controls-icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { useUiLanguage } from '../../composables/useUiLanguage'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolderOpen from '../icons/IconTablerFolderOpen.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'

defineProps<{
  isSidebarCollapsed: boolean
  showNewThreadButton?: boolean
  showFileBrowserButton?: boolean
  fileBrowserDisabled?: boolean
}>()

defineEmits<{
  'toggle-sidebar': []
  'start-new-thread': []
  'browse-files': []
}>()

const { t } = useUiLanguage()
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-thread-controls {
  @apply flex flex-row flex-nowrap items-center gap-2;
}

.sidebar-thread-controls-button {
  @apply h-6.75 w-6.75 rounded-md border border-transparent bg-transparent text-zinc-600 flex items-center justify-center transition hover:border-zinc-200 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent;
}

.sidebar-thread-controls-icon {
  @apply w-4 h-4;
}
</style>
