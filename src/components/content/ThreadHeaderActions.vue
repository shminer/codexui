<template>
  <div ref="root" class="thread-header-actions" @keydown="onKeydown">
    <button ref="trigger" class="thread-header-actions-trigger" type="button"
      :title="t('Conversation actions')" :aria-label="t('Conversation actions')"
      aria-haspopup="menu" :aria-expanded="isOpen" @click="toggle"
      @keydown.down.prevent.stop="openMenu()" @keydown.up.prevent.stop="openMenu(true)">
      <IconTablerDots />
    </button>
    <Teleport to="body">
    <div v-if="isOpen" ref="panel" class="thread-header-actions-panel" role="menu" :style="panelStyle" @keydown="onKeydown"
      :aria-label="t(terminalPage ? 'Terminal' : 'Conversation actions')">
      <template v-if="terminalPage">
        <button type="button" role="menuitem" class="thread-header-actions-item" @click="showPage(false)">
          <IconTablerChevronLeft />{{ t('Back') }}
        </button>
        <button v-for="command in terminalCommands" :key="command.value" type="button" role="menuitem"
          class="thread-header-actions-item" :disabled="!terminalAvailable" @click="selectTerminal(command.value)">
          {{ command.label }}
        </button>
      </template>
      <template v-else>
        <button type="button" role="menuitem" class="thread-header-actions-item" @click="select('newConversation')">{{ t('New conversation') }}</button>
        <button type="button" role="menuitem" class="thread-header-actions-item" :disabled="!terminalAvailable"
          aria-haspopup="menu" @click="showPage(true)">{{ t('Terminal') }}<IconTablerChevronRight /></button>
        <button type="button" role="menuitem" class="thread-header-actions-item" :disabled="!panelsAvailable"
          @click="select('search')">{{ t('Find in thread') }}</button>
        <button type="button" role="menuitem" class="thread-header-actions-item" :disabled="!panelsAvailable"
          @click="select('resources')">{{ t('Thread resources') }}</button>
      </template>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUiLanguage } from '../../composables/useUiLanguage'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerChevronLeft from '../icons/IconTablerChevronLeft.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'

const props = defineProps<{
  contextKey: string
  terminalAvailable: boolean
  panelsAvailable: boolean
  terminalCommands: { label: string; value: string }[]
}>()
const emit = defineEmits<{
  newConversation: []
  search: []
  resources: []
  terminal: [command: string]
}>()
const { t } = useUiLanguage()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const terminalPage = ref(false)
const panelStyle = ref({ left: '0px', top: '0px' })

function updatePosition(): void {
  if (!isOpen.value || !trigger.value || !panel.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = panel.value.offsetWidth, height = panel.value.offsetHeight
  panelStyle.value = {
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8))}px`,
  }
}

function items(): HTMLButtonElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
}
async function openMenu(last = false): Promise<void> {
  terminalPage.value = false
  isOpen.value = true
  await nextTick()
  updatePosition()
  const buttons = items()
  buttons[last ? buttons.length - 1 : 0]?.focus()
}
function close(restoreFocus = true): void {
  if (!isOpen.value) return
  isOpen.value = false
  terminalPage.value = false
  if (restoreFocus) trigger.value?.focus()
}
function toggle(): void { if (isOpen.value) close(); else void openMenu() }
async function showPage(terminal: boolean): Promise<void> {
  terminalPage.value = terminal
  await nextTick()
  updatePosition()
  items()[terminal ? 0 : 1]?.focus()
}
function select(action: 'newConversation' | 'search' | 'resources'): void {
  close()
  if (action === 'newConversation') emit('newConversation')
  else if (action === 'search') emit('search')
  else emit('resources')
}
function selectTerminal(command: string): void { close(); emit('terminal', command) }
function onOutside(event: PointerEvent): void {
  if (event.target instanceof Node && !root.value?.contains(event.target) && !panel.value?.contains(event.target)) {
    close()
    // Restore after the pointer's default focus action.
    requestAnimationFrame(() => { if (root.value?.isConnected && !isOpen.value) trigger.value?.focus() })
  }
}
function onKeydown(event: KeyboardEvent): void {
  if (!isOpen.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key === 'Tab') { close(); return }
  if (event.key === 'ArrowLeft' && terminalPage.value) { event.preventDefault(); void showPage(false); return }
  if (event.key === 'ArrowRight' && !terminalPage.value && document.activeElement === items()[1] && props.terminalAvailable) {
    event.preventDefault(); void showPage(true); return
  }
  const buttons = items()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  let next: number
  if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
  else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else return
  event.preventDefault()
  buttons[next]?.focus()
}
watch(isOpen, (open) => {
  if (open) {
    window.addEventListener('pointerdown', onOutside)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
  } else removeListeners()
}, { flush: 'sync' })
function removeListeners(): void {
  window.removeEventListener('pointerdown', onOutside)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
}
watch(() => props.contextKey, () => close(false))
onBeforeUnmount(removeListeners)
</script>
