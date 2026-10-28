<template>
  <div ref="host" class="mermaid-block" :style="expanded ? { minHeight: `${inlineHeight}px` } : undefined" @click.stop>
    <Teleport :to="ownerDocument?.body ?? 'body'" :disabled="!expanded">
      <div :class="{ 'mermaid-backdrop': expanded }" @click.self="closeExpanded">
        <section
          ref="surface"
          class="mermaid-surface"
          :class="{ 'mermaid-surface-expanded': expanded }"
          :role="expanded ? 'dialog' : 'group'"
          :aria-modal="expanded ? true : undefined"
          :aria-label="t('Mermaid diagram')"
          @keydown="onKeydown"
          @click.stop
        >
          <div class="mermaid-toolbar">
            <span class="mermaid-label">Mermaid</span>
            <button type="button" :disabled="!svg" :aria-label="t('Zoom out')" :title="t('Zoom out')" @click="zoomTo(view.zoom / 1.25)">−</button>
            <output class="mermaid-zoom" aria-live="polite">{{ Math.round(view.zoom * 100) }}%</output>
            <button type="button" :disabled="!svg" :aria-label="t('Zoom in')" :title="t('Zoom in')" @click="zoomTo(view.zoom * 1.25)">+</button>
            <button type="button" :disabled="!svg" @click="fit">{{ t('Fit diagram') }}</button>
            <button type="button" @click="copyController.copyOutput($event)">{{ t(copied ? 'Copied' : 'Copy Mermaid source') }}</button>
            <button v-if="!expanded" ref="expandButton" type="button" @click="openExpanded">{{ t('Expand diagram') }}</button>
            <button v-else ref="closeButton" type="button" @click="closeExpanded">{{ t('Close diagram') }}</button>
          </div>
          <p v-if="copyError" class="mermaid-status mermaid-error" role="status">{{ t(copyError) }}</p>
          <p v-if="error" class="mermaid-status mermaid-error" role="status">{{ t('Could not render Mermaid diagram') }}</p>
          <p v-else-if="!streaming && !svg" class="mermaid-status" role="status">{{ t('Rendering diagram...') }}</p>
          <div
            v-if="svg && !streaming && !error"
            ref="canvas"
            class="mermaid-canvas"
            :class="{ 'is-dragging': drag }"
            tabindex="0"
            :aria-label="t('Diagram: scroll to zoom, drag to pan, arrow keys to move')"
            @wheel.stop.prevent="onWheel"
            @pointerdown.stop="onPointerDown"
            @pointermove.stop="onPointerMove"
            @pointerup.stop="endDrag"
            @pointercancel.stop="endDrag"
            @lostpointercapture="endDrag"
            @touchstart.stop
            @touchmove.stop
            @keydown="onCanvasKeydown"
          >
            <div class="mermaid-diagram" :style="diagramStyle" v-html="svg" />
          </div>
          <pre v-else class="mermaid-source"><code>{{ source }}</code></pre>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useUiLanguage } from '../../composables/useUiLanguage'
import { createOutputBlockCopyController } from './outputBlockCopyController'
import { renderMermaid } from './mermaidRenderer'
import { mermaidWheelZoom, prepareMermaidSvg, zoomMermaidViewport, type MermaidViewport } from './mermaidViewport'

const props = defineProps<{ source: string; streaming?: boolean; ownerDocument?: Document }>()
const { t } = useUiLanguage()
const host = ref<HTMLElement>()
const surface = ref<HTMLElement>()
const canvas = ref<HTMLElement>()
const expandButton = ref<HTMLButtonElement>()
const closeButton = ref<HTMLButtonElement>()
const expanded = ref(false)
const inlineHeight = ref(0)
const svg = ref('')
const error = ref(false)
const copied = ref(false)
const copyError = ref('')
const dark = ref(false)
const visible = ref(false)
const view = ref<MermaidViewport>({ zoom: 1, x: 0, y: 0 })
const diagramSize = ref({ width: 1, height: 1 })
const canvasSize = ref({ width: 1, height: 1 })
const drag = shallowRef<{ pointerId: number; x: number; y: number; target: HTMLElement }>()
let inlineView: MermaidViewport | undefined
let renderGeneration = 0
let disposed = false
let renderedSource = ''
let renderedDark = false
let themeObserver: MutationObserver | undefined
let visibilityObserver: IntersectionObserver | undefined
let sizeObserver: ResizeObserver | undefined
let dialogDocument: Document | undefined
let previousFocus: HTMLElement | null = null

const copyController = createOutputBlockCopyController({
  getCopyText: () => props.source,
  onStateChange: (state) => {
    copied.value = state.copied
    copyError.value = state.errorText
  },
})

const diagramStyle = computed(() => {
  const fitScale = Math.min(
    Math.max(1, canvasSize.value.width - 32) / diagramSize.value.width,
    Math.max(1, canvasSize.value.height - 32) / diagramSize.value.height,
    1,
  )
  return {
    width: `${diagramSize.value.width}px`,
    height: `${diagramSize.value.height}px`,
    transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${fitScale * view.value.zoom}) translate(-50%, -50%)`,
  }
})

function fit(): void {
  endDrag()
  view.value = { zoom: 1, x: 0, y: 0 }
}

function zoomTo(zoom: number, x = 0, y = 0): void {
  view.value = zoomMermaidViewport(view.value, zoom, x, y)
}

function onWheel(event: WheelEvent): void {
  const bounds = canvas.value!.getBoundingClientRect()
  zoomTo(mermaidWheelZoom(view.value.zoom, event.deltaY, event.deltaMode),
    event.clientX - bounds.left - bounds.width / 2,
    event.clientY - bounds.top - bounds.height / 2)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || drag.value) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  drag.value = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, target }
  target.ownerDocument.defaultView?.addEventListener('blur', cancelDrag)
}

function onPointerMove(event: PointerEvent): void {
  const active = drag.value
  if (!active || active.pointerId !== event.pointerId) return
  view.value = { ...view.value, x: view.value.x + event.clientX - active.x, y: view.value.y + event.clientY - active.y }
  active.x = event.clientX
  active.y = event.clientY
}

function endDrag(event?: PointerEvent): void {
  const active = drag.value
  if (!active || (event && event.pointerId !== active.pointerId)) return
  drag.value = undefined
  active.target.ownerDocument.defaultView?.removeEventListener('blur', cancelDrag)
  if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
}

function cancelDrag(): void { endDrag() }

function onCanvasKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '+' || event.key === '=') zoomTo(view.value.zoom * 1.25)
  else if (event.key === '-') zoomTo(view.value.zoom / 1.25)
  else if (event.key === '0') fit()
  else if (event.key === 'ArrowLeft') view.value.x -= 30
  else if (event.key === 'ArrowRight') view.value.x += 30
  else if (event.key === 'ArrowUp') view.value.y -= 30
  else if (event.key === 'ArrowDown') view.value.y += 30
  else return
  event.preventDefault()
  event.stopPropagation()
}

function onKeydown(event: KeyboardEvent): void {
  if (!expanded.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeExpanded()
  } else if (event.key === 'Tab') {
    const focusable = surface.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = surface.value?.ownerDocument.activeElement
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
  }
}

function keepDialogFocus(event: FocusEvent): void {
  if (expanded.value && !surface.value?.contains(event.target as Node)) closeButton.value?.focus({ preventScroll: true })
}

async function openExpanded(): Promise<void> {
  endDrag()
  previousFocus = surface.value?.ownerDocument.activeElement as HTMLElement | null
  inlineView = { ...view.value }
  inlineHeight.value = host.value?.getBoundingClientRect().height ?? 0
  expanded.value = true
  visible.value = true
  fit()
  await nextTick()
  if (!expanded.value || disposed) return
  dialogDocument = surface.value?.ownerDocument
  dialogDocument?.addEventListener('focusin', keepDialogFocus)
  closeButton.value?.focus({ preventScroll: true })
}

function closeExpanded(): void {
  if (!expanded.value) return
  endDrag()
  expanded.value = false
  dialogDocument?.removeEventListener('focusin', keepDialogFocus)
  dialogDocument = undefined
  if (inlineView) view.value = inlineView
  void nextTick(() => {
    if (!disposed) (expandButton.value ?? previousFocus)?.focus({ preventScroll: true })
  })
}

function bindDocument(): void {
  themeObserver?.disconnect()
  visibilityObserver?.disconnect()
  const ownerDocument = props.ownerDocument ?? host.value?.ownerDocument
  if (!ownerDocument) return
  const ownerWindow = ownerDocument.defaultView ?? window
  const updateTheme = () => { dark.value = ownerDocument.documentElement.classList.contains('dark') }
  updateTheme()
  themeObserver = new ownerWindow.MutationObserver(updateTheme)
  themeObserver.observe(ownerDocument.documentElement, { attributes: true, attributeFilter: ['class'] })
  if (!visible.value) {
    visibilityObserver = new ownerWindow.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true
        visibilityObserver?.disconnect()
      }
    }, { rootMargin: '200px' })
    visibilityObserver.observe(host.value!)
  }
  observeCanvas(canvas.value)
}

onMounted(bindDocument)

watch(() => props.ownerDocument, () => {
  closeExpanded()
  endDrag()
  bindDocument()
}, { flush: 'post' })

function observeCanvas(element: HTMLElement | undefined): void {
  sizeObserver?.disconnect()
  endDrag()
  if (!element) return
  const measure = () => { canvasSize.value = { width: element.clientWidth, height: element.clientHeight } }
  measure()
  sizeObserver = new (element.ownerDocument.defaultView ?? window).ResizeObserver(measure)
  sizeObserver.observe(element)
}

watch(canvas, observeCanvas, { flush: 'post' })

watch([() => props.source, () => props.streaming, dark, visible], async ([source, streaming, isDark, isVisible]) => {
  const generation = ++renderGeneration
  if (streaming || !isVisible) return
  if (svg.value && source === renderedSource && isDark === renderedDark) return
  const isCurrent = () => !disposed && generation === renderGeneration
  error.value = false
  svg.value = ''
  try {
    const result = await renderMermaid(source, isDark, isCurrent)
    if (!result || !isCurrent()) return
    svg.value = result
    await nextTick()
    if (!isCurrent()) return
    const element = canvas.value?.querySelector('svg')
    if (!element) throw new Error('Missing diagram SVG')
    diagramSize.value = prepareMermaidSvg(element)
    renderedSource = source
    renderedDark = isDark
    if (expanded.value) inlineView = { zoom: 1, x: 0, y: 0 }
    fit()
  } catch {
    if (isCurrent()) {
      svg.value = ''
      error.value = true
    }
  }
}, { immediate: true })

onBeforeUnmount(() => {
  disposed = true
  renderGeneration++
  endDrag()
  themeObserver?.disconnect()
  visibilityObserver?.disconnect()
  sizeObserver?.disconnect()
  dialogDocument?.removeEventListener('focusin', keepDialogFocus)
  copyController.dispose()
  if (expanded.value && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>
