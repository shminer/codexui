import { createApp, h, nextTick, reactive, ref } from 'vue'
import ThreadSideConversation from '../../src/components/content/ThreadSideConversation.vue'
import ThreadConversation from '../../src/components/content/ThreadConversation.vue'
import '../../src/style.css'

const paragraph = '切出浏览器后返回，新内容应自然撑开消息区域，后续消息不能覆盖前文。The next message must follow the complete answer in document order.'
export function turn(index) {
  const turnId = `turn-${index}`
  const message = (suffix, role, text, extra = {}) => ({ id: `${turnId}-${suffix}`, turnId, role, text, ...extra })
  return [
    message('user', 'user', `第 ${index} 轮：检查侧窗布局与完整正文`),
    message('commentary', 'assistant', `${paragraph}\n\n${paragraph}`, { messageType: 'agentMessage' }),
    ...[0, 1].map(command => message(`cmd-${command}`, 'system', '', {
      messageType: 'commandExecution', commandExecution: {
        command: `echo side-flow-${index}-${command}`, status: 'completed', exitCode: 0,
        aggregatedOutput: `command output ${index}\n${paragraph}`, cwd: null,
      },
    })),
    message('answer', 'assistant', `${paragraph}\n\n${paragraph}\n\n\`\`\`js\nconst round = ${index};\nconsole.log(round);\n\`\`\`\n\n| 检查项 | 结果 |\n| --- | --- |\n| 正文 | 完整展示 |\n| 布局 | 无重叠 |\n\nEND-MARKER-${index}`, { messageType: 'agentMessage' }),
    message('compact', 'system', 'Context compacted', { messageType: 'contextCompaction' }),
    message('worked', 'system', 'Worked for 3s', { messageType: 'worked' }),
  ]
}

const initialMessages = Array.from({ length: 30 }, (_, index) => turn(index)).flat()
const requests = { earlier: 0, later: 0, latest: 0 }
const state = reactive({
  mode: 'side', mounted: true, visible: true,
  threadId: 'side-flow-regression', chatWidth: 800, historyTruncated: false,
  hasMoreOlder: true, hasMoreNewer: false, isHistoryWindow: false,
  loadingOlder: false, loadingNewer: false, historyCapacityReached: false,
  cwd: '', messages: initialMessages, pendingRequests: [], liveOverlay: null,
  error: '', isOpening: false, isTurnInProgress: false, isUpdatingSpeedMode: false,
  isImplementingPlan: false, followLatestRevision: 0,
  collaborationModes: [], selectedCollaborationMode: 'default', models: ['test-model'],
  selectedModel: 'test-model', supportedReasoningEfforts: ['high'], selectedReasoningEffort: 'high',
  selectedSpeedMode: 'standard', skills: [], queuedMessages: [], inProgressSubmitMode: 'steer',
})
async function loadEarlierMessages() {
  requests.earlier++
  if (window.fixture.failEarlier) throw new Error('Synthetic history failure')
  state.messages = [...turn(-requests.earlier), ...state.messages]
  await nextTick()
}
async function loadLaterMessages() {
  requests.later++
  state.messages = [...state.messages, ...turn(100 + requests.later)]
  state.hasMoreNewer = false
  await nextTick()
}
async function loadLatestMessages() {
  requests.latest++
  state.messages = initialMessages
  state.hasMoreNewer = state.isHistoryWindow = false
  await nextTick()
}
const conversation = ref()
const app = createApp({
  setup: () => () => !state.mounted ? null : state.mode === 'side'
    ? h(ThreadSideConversation, {
      ...state, loadEarlierMessages, loadLaterMessages, loadLatestMessages,
      onMinimize: () => { state.visible = false },
      onEnd: () => { state.mounted = false },
    })
    : h(ThreadConversation, {
      ref: conversation, messages: state.messages, pendingRequests: [], liveOverlay: state.liveOverlay,
      isLoading: false, activeThreadId: state.threadId, cwd: '',
      virtualized: state.mode === 'main',
      hasMorePersistedAbove: state.hasMoreOlder, hasMorePersistedBelow: state.hasMoreNewer,
      isHistoryWindow: state.isHistoryWindow, loadEarlierMessages, loadLaterMessages, loadLatestMessages,
    }),
})
app.mount('#app')
window.fixture = {
  state, requests, failEarlier: false,
  async append(index, streaming = false) {
    const messages = turn(index)
    if (streaming) {
      messages[4].messageType = 'agentMessage.live'
      messages[4].text = paragraph
      messages.length = 5
    }
    state.messages = [...state.messages, ...messages]
    await nextTick()
  },
  async complete(index) {
    state.messages = [...state.messages.filter(message => message.turnId !== `turn-${index}`), ...turn(index)]
    await nextTick()
  },
  async stress() {
    state.messages = Array.from({ length: 1000 }, (_, index) => ({
      id: `stress-${index}`, role: index % 2 ? 'assistant' : 'user', turnId: `stress-turn-${index >> 1}`,
      text: `${index}: ${paragraph.repeat(70)}\n\nSTRESS-END-${index}`,
    }))
    await nextTick()
  },
  async locate(id) { await conversation.value.locateMessage(id) },
  async latest() { await conversation.value.jumpToLatest() },
  unmount() { app.unmount() },
}
