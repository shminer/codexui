import { createApp, h } from 'vue'
import { useDesktopState } from '../../src/composables/useDesktopState'
import ThreadConversation from '../../src/components/content/ThreadConversation.vue'
import '../../src/style.css'

const state = useDesktopState()
const threadId = 'plan-browser-test'
state.registerThreadSummary({
  id: threadId, title: 'Plan realtime regression', projectName: 'Test', cwd: '',
  createdAtIso: new Date().toISOString(), updatedAtIso: new Date().toISOString(),
  preview: '', unread: false, inProgress: false,
})
state.primeSelectedThread(threadId)
state.startPolling()
const virtualized = new URL(location.href).searchParams.get('mode') !== 'flow'
const app = createApp({
  setup: () => () => h(ThreadConversation, {
    messages: state.messages.value, pendingRequests: [], liveOverlay: state.selectedLiveOverlay.value,
    isLoading: false, activeThreadId: threadId, cwd: '', virtualized,
  }),
})
app.mount('#app')
window.planTest = {
  messages: () => state.messages.value,
  stop() { app.unmount(); state.stopPolling() },
}
