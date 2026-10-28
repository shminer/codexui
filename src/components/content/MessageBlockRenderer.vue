<template>
  <div
    v-for="(paragraph, paragraphIndex) in item.paragraphs"
    :key="`paragraph-${paragraphIndex}`"
    class="message-list-item-text message-list-item-paragraph"
    v-html="renderInlineHtml(paragraph)"
  />
  <template v-for="(block, blockIndex) in item.children ?? []" :key="`block-${blockIndex}`">
    <MermaidBlock
      v-if="block.kind === 'codeBlock' && isMermaidLanguage(block.language)"
      :source="block.value"
      :streaming="streaming"
      :owner-document="ownerDocument"
    />
    <div v-else-if="block.kind === 'codeBlock'" class="message-code-block">
      <CopyableOutputBlock :copy-text="block.value" label="Copy code block">
        <div v-if="block.language" class="message-code-language">{{ block.language }}</div>
        <pre class="message-code-pre"><code class="hljs" v-html="renderHighlightedCodeHtml(block.language, block.value)"></code></pre>
      </CopyableOutputBlock>
    </div>
    <ul v-else-if="block.kind === 'unorderedList'" class="message-list message-list-unordered">
      <li v-for="(childItem, itemIndex) in block.items" :key="`ul-${blockIndex}-${itemIndex}`" class="message-list-item">
        <div class="message-list-item-content">
          <MessageBlockRenderer
            :item="childItem"
            :streaming="streaming"
            :owner-document="ownerDocument"
            :render-inline-html="renderInlineHtml"
            :render-block-html="renderBlockHtml"
            :render-highlighted-code-html="renderHighlightedCodeHtml"
          />
        </div>
      </li>
    </ul>
    <ol
      v-else-if="block.kind === 'orderedList'"
      class="message-list message-list-ordered"
      :start="block.start"
    >
      <li v-for="(childItem, itemIndex) in block.items" :key="`ol-${blockIndex}-${itemIndex}`" class="message-list-item">
        <div class="message-list-item-content">
          <MessageBlockRenderer
            :item="childItem"
            :streaming="streaming"
            :owner-document="ownerDocument"
            :render-inline-html="renderInlineHtml"
            :render-block-html="renderBlockHtml"
            :render-highlighted-code-html="renderHighlightedCodeHtml"
          />
        </div>
      </li>
    </ol>
    <div v-else class="message-nested-block" v-html="renderBlockHtml(block)" />
  </template>
</template>

<script setup lang="ts">
import type { ListItem, MessageBlock } from './messageBlockTypes'
import CopyableOutputBlock from './CopyableOutputBlock.vue'
import MermaidBlock from './MermaidBlock.vue'
import { isMermaidLanguage } from './mermaidViewport'

defineOptions({ name: 'MessageBlockRenderer' })

defineProps<{
  item: ListItem
  streaming?: boolean
  ownerDocument?: Document
  renderInlineHtml: (text: string) => string
  renderBlockHtml: (block: MessageBlock) => string
  renderHighlightedCodeHtml: (language: string, value: string) => string
}>()
</script>

<style scoped>
@reference "tailwindcss";

.message-list {
  @apply m-0 pl-5 text-sm leading-relaxed text-slate-800 flex flex-col gap-1.5;
}

.message-list-unordered {
  @apply list-disc;
}

.message-list-ordered {
  @apply list-decimal;
}

.message-list-item {
  @apply pl-1;
}

.message-list-item-content {
  @apply flex flex-col gap-1.5;
}

.message-list-item-text {
  @apply whitespace-pre-wrap break-words;
  overflow-wrap: anywhere;
}

.message-list-item-paragraph + .message-list-item-paragraph {
  @apply mt-2;
}

.message-code-block {
  @apply overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100;
}

.message-code-language {
  @apply border-b border-slate-800 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-slate-400;
}

.message-code-pre {
  @apply m-0 overflow-x-auto px-3 py-3 text-[13px] leading-relaxed font-mono whitespace-pre;
}

.message-code-pre :deep(.hljs) {
  @apply block bg-transparent p-0 text-inherit;
}
</style>
