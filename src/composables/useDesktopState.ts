import { computed, ref } from 'vue'
import {

  archiveThread,
  clearThreadGoal,
  discardSideConversationThreadInBackground,
  discardSideConversationThreadOnPageHide,
  forkThread,
  getAvailableCollaborationModes,
  getAccountRateLimits,
  renameThread,
  getAvailableModelIds,
  getCurrentModelConfig,
  getPendingServerRequests,
  getSkillsList,
  getThreadGoal,
  getThreadDetail,
  getThreadSummary,
  getRecentThreadDetail,
  getOlderThreadMessages,
  getBackgroundThreadListLimit,
  interruptThreadTurn,
  normalizeThreadGoal,
  pickCodexRateLimitSnapshot,
  replyToServerRequest,
  revertThreadFileChanges,
  rollbackThread,
  getThreadGroupsPage,
  getThreadQueueState,
  getWorkspaceRootsState,
  setCodexSpeedMode,
  setThreadGoal,
  setThreadQueueState,
  setWorkspaceRootsState,
  getThreadTitleCache,
  persistThreadTitle,
  generateThreadTitle,
  resumeThread,

  startThread,
  startSideConversation as startSideConversationThread,
  subscribeCodexNotifications,
  startThreadTurn,
  type RpcNotification,
  type SkillInfo,
  type ThreadQueueState,
  type UiSubagent,
  type WorkspaceRootsState,
} from '../api/codexGateway'
import { normalizeFileChangeStatus, toUiFileChanges } from '../api/normalizers/v2'
import type {
  CollaborationModeKind,
  CollaborationModeOption,
  CommandExecutionData,
  UiPendingRequestState,
  ReasoningEffort,
  SpeedMode,
  UiFileChange,
  UiLiveOverlay,
  UiMessage,
  UiPlanData,
  UiPlanStep,
  UiProjectGroup,
  UiRateLimitSnapshot,
  UiServerRequest,
  UiServerRequestReply,
  UiThreadTokenUsage,
  UiTokenUsageBreakdown,
  UiThread,
  UiThreadGoal,
  ThreadGoalStatus,
} from '../types/codex'
import { REASONING_EFFORTS } from '../types/codex'
import { getPathParent, isProjectlessChatPath, normalizePathForUi, toProjectName } from '../pathUtils.js'
import { resolveTurnCompletionDisposition, type TurnTerminalStatus } from './threadLifecycle'

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

export function findAdjacentThreadId(threads: UiThread[], threadId: string): string {
  const targetIndex = threads.findIndex((thread) => thread.id === threadId)
  if (targetIndex < 0) return ''
  return threads[targetIndex + 1]?.id ?? threads[targetIndex - 1]?.id ?? ''
}

const READ_STATE_STORAGE_KEY = 'codex-web-local.thread-read-state.v1'
const UNREAD_CUTOFF_STORAGE_KEY = 'codex-web-local.thread-unread-cutoff.v1'
const THREAD_TOKEN_USAGE_STORAGE_KEY = 'codex-web-local.thread-token-usage.v1'
const TURN_SUMMARIES_STORAGE_KEY = 'codex-web-local.turn-summaries.v1'
const THREAD_TERMINAL_OPEN_STORAGE_KEY = 'codex-web-local.thread-terminal-open.v1'
const SELECTED_THREAD_STORAGE_KEY = 'codex-web-local.selected-thread-id.v1'
const SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY = 'codex-web-local.selected-model-by-context.v1'
const SELECTED_REASONING_EFFORT_BY_CONTEXT_STORAGE_KEY = 'codex-web-local.selected-reasoning-effort-by-context.v1'
const LEGACY_SELECTED_MODEL_STORAGE_KEY = 'codex-web-local.selected-model-id.v1'
const PROJECT_ORDER_STORAGE_KEY = 'codex-web-local.project-order.v1'
const PROJECT_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.project-display-name.v1'
const COLLABORATION_MODE_STORAGE_KEY = 'codex-web-local.collaboration-mode-by-context.v1'
const LEGACY_COLLABORATION_MODE_STORAGE_KEY = 'codex-web-local.collaboration-mode.v1'
const NEW_THREAD_COLLABORATION_MODE_CONTEXT = '__new-thread__'
const NEW_THREAD_PROVIDER_MODEL_CONTEXT_PREFIX = '__new-thread-provider__::'
const EVENT_SYNC_DEBOUNCE_MS = 220
const BACKGROUND_THREAD_PAGINATION_DELAY_MS = 10_000
const RATE_LIMIT_REFRESH_DEBOUNCE_MS = 500
const TURN_START_FOLLOW_UP_SYNC_DELAY_MS = 3000
const RECENT_THREAD_MESSAGE_LOAD_REUSE_MS = 2000
const RECENT_THREAD_LIST_LOAD_REUSE_MS = 2000
const RECENT_SKILLS_LOAD_REUSE_MS = 2000
const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = REASONING_EFFORTS
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const MODEL_FALLBACK_ID = 'gpt-5.4-mini'
const OPENCODE_ZEN_DEFAULT_MODEL = 'big-pickle'
const CODEX_CLI_MISSING_MESSAGE = 'Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'
const DEFAULT_ACCOUNT_STORAGE_ID = '__default__'
const MAX_DISCARDED_SIDE_CONVERSATION_THREAD_IDS = 256
const MAX_SAVED_TURN_SUMMARIES_PER_THREAD = 100

function isCodexCliMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('Codex CLI is not available')
}

function loadReadStateMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(READ_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function saveReadStateMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadUnreadCutoffIso(): string {
  if (typeof window === 'undefined') return ''

  const existing = window.localStorage.getItem(UNREAD_CUTOFF_STORAGE_KEY)
  if (existing) return existing

  const initialCutoff = new Date().toISOString()
  window.localStorage.setItem(UNREAD_CUTOFF_STORAGE_KEY, initialCutoff)
  return initialCutoff
}

function saveUnreadCutoffIso(cutoffIso: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(UNREAD_CUTOFF_STORAGE_KEY, cutoffIso)
}

function isThreadUpdatedAfterCutoff(updatedAtIso: string, cutoffIso: string): boolean {
  if (!updatedAtIso || !cutoffIso) return false
  const updatedAtMs = new Date(updatedAtIso).getTime()
  const cutoffMs = new Date(cutoffIso).getTime()
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(cutoffMs)) return false
  return updatedAtMs > cutoffMs
}

export function isThreadUnreadByLastRead(
  updatedAtIso: string,
  threadReadStateIso: string | undefined,
  unreadCutoffIso: string,
): boolean {
  const effectiveLastReadIso = threadReadStateIso ?? unreadCutoffIso
  return isThreadUpdatedAfterCutoff(updatedAtIso, effectiveLastReadIso)
}

function normalizeCollaborationMode(value: unknown): CollaborationModeKind {
  return value === 'plan' ? 'plan' : 'default'
}

function normalizeStoredModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStoredReasoningEffort(value: unknown): ReasoningEffort | '' {
  return typeof value === 'string' && REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort)
    ? value as ReasoningEffort
    : ''
}

function createStringKeyedRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function cloneStringKeyedRecord<T>(record: Record<string, T>): Record<string, T> {
  const next = createStringKeyedRecord<T>()
  for (const [key, value] of Object.entries(record)) {
    next[key] = value
  }
  return next
}

function omitStringKeyedRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = createStringKeyedRecord<T>()
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) {
      next[entryKey] = value
    }
  }
  return next
}

function pruneThreadContextStateMap<T>(
  stateMap: Record<string, T>,
  threadIds: Set<string>,
): Record<string, T> {
  let changed = false
  const next = createStringKeyedRecord<T>()
  for (const [contextId, value] of Object.entries(stateMap)) {
    if (
      contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
      || contextId.startsWith(NEW_THREAD_PROVIDER_MODEL_CONTEXT_PREFIX)
      || threadIds.has(contextId)
    ) {
      next[contextId] = value
      continue
    }
    changed = true
  }
  return changed ? next : stateMap
}

function normalizeProviderContextId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase().replace(/_/g, '-')
  if (!normalized || normalized === 'openai') return 'codex'
  return normalized
}

function isNewThreadContextId(contextId: string): boolean {
  return contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
}

function toProviderModelContextId(
  providerId: string,
  accountId = DEFAULT_ACCOUNT_STORAGE_ID,
): string {
  const normalizedProviderId = normalizeProviderContextId(providerId)
  if (!normalizedProviderId) return ''
  return `${NEW_THREAD_PROVIDER_MODEL_CONTEXT_PREFIX}${accountId.trim() || DEFAULT_ACCOUNT_STORAGE_ID}::${normalizedProviderId}`
}

function toThreadContextId(threadId: string): string {
  const normalizedThreadId = threadId.trim()
  return normalizedThreadId || NEW_THREAD_COLLABORATION_MODE_CONTEXT
}

function loadSelectedModelMap(): Record<string, string> {
  if (typeof window === 'undefined') return createStringKeyedRecord<string>()

  try {
    const raw = window.localStorage.getItem(SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return createStringKeyedRecord<string>()

      const next = createStringKeyedRecord<string>()
      for (const [contextId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof contextId !== 'string' || contextId.length === 0) continue
        const normalizedModelId = normalizeStoredModelId(value)
        if (normalizedModelId) {
          next[contextId] = normalizedModelId
        }
      }
      return next
    }
  } catch {
    // Fall back to the legacy global preference below.
  }

  const legacyModelId = normalizeStoredModelId(window.localStorage.getItem(LEGACY_SELECTED_MODEL_STORAGE_KEY))
  const next = createStringKeyedRecord<string>()
  if (legacyModelId) {
    next[NEW_THREAD_COLLABORATION_MODE_CONTEXT] = legacyModelId
  }
  return next
}

function readSelectedModel(
  state: Record<string, string>,
  threadId: string,
): string {
  const contextId = toThreadContextId(threadId)
  const contextModelId = normalizeStoredModelId(state[contextId])
  if (contextModelId) return contextModelId
  return normalizeStoredModelId(state[NEW_THREAD_COLLABORATION_MODE_CONTEXT])
}

function saveSelectedModelMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(state).length === 0) {
      window.localStorage.removeItem(SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY)
    } else {
      window.localStorage.setItem(SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY, JSON.stringify(state))
    }
    window.localStorage.removeItem(LEGACY_SELECTED_MODEL_STORAGE_KEY)
  } catch {
    // Keep in-memory selection working even if localStorage writes fail.
  }
}

function loadSelectedReasoningEffortMap(): Record<string, ReasoningEffort> {
  if (typeof window === 'undefined') return createStringKeyedRecord<ReasoningEffort>()

  try {
    const raw = window.localStorage.getItem(SELECTED_REASONING_EFFORT_BY_CONTEXT_STORAGE_KEY)
    if (!raw) return createStringKeyedRecord<ReasoningEffort>()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createStringKeyedRecord<ReasoningEffort>()
    }

    const next = createStringKeyedRecord<ReasoningEffort>()
    for (const [contextId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const effort = normalizeStoredReasoningEffort(value)
      if (contextId && effort) next[contextId] = effort
    }
    return next
  } catch {
    return createStringKeyedRecord<ReasoningEffort>()
  }
}

function readSelectedReasoningEffort(
  state: Record<string, ReasoningEffort>,
  threadId: string,
  providerId = '',
  accountId = DEFAULT_ACCOUNT_STORAGE_ID,
): ReasoningEffort | '' {
  const contextId = toThreadContextId(threadId)
  const threadEffort = normalizeStoredReasoningEffort(state[contextId])
  if (threadEffort) return threadEffort
  if (!isNewThreadContextId(contextId)) return ''

  const providerContextId = toProviderModelContextId(providerId, accountId)
  const providerEffort = providerContextId
    ? normalizeStoredReasoningEffort(state[providerContextId])
    : ''
  if (providerEffort) return providerEffort

  return normalizeStoredReasoningEffort(state[NEW_THREAD_COLLABORATION_MODE_CONTEXT])
}

function saveSelectedReasoningEffortMap(state: Record<string, ReasoningEffort>): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(state).length === 0) {
      window.localStorage.removeItem(SELECTED_REASONING_EFFORT_BY_CONTEXT_STORAGE_KEY)
    } else {
      window.localStorage.setItem(SELECTED_REASONING_EFFORT_BY_CONTEXT_STORAGE_KEY, JSON.stringify(state))
    }
  } catch {
    // Keep in-memory selection working even if localStorage writes fail.
  }
}

function normalizeAccountStorageId(accountId: string): string {
  return accountId.trim() || DEFAULT_ACCOUNT_STORAGE_ID
}

function loadSelectedCollaborationModeMap(): Record<string, CollaborationModeKind> {
  if (typeof window === 'undefined') return createStringKeyedRecord<CollaborationModeKind>()

  try {
    const raw = window.localStorage.getItem(COLLABORATION_MODE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createStringKeyedRecord<CollaborationModeKind>()
      }

      const next = createStringKeyedRecord<CollaborationModeKind>()
      for (const [contextId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof contextId !== 'string' || contextId.length === 0) continue
        const normalizedMode = normalizeCollaborationMode(value)
        if (normalizedMode === 'plan') {
          next[contextId] = normalizedMode
        }
      }
      return next
    }
  } catch {
    // Fall back to the legacy global preference below.
  }

  return createStringKeyedRecord<CollaborationModeKind>()
}

function readSelectedCollaborationMode(
  state: Record<string, CollaborationModeKind>,
  threadId: string,
): CollaborationModeKind {
  const contextId = toThreadContextId(threadId)
  return normalizeCollaborationMode(state[contextId])
}

function writeSelectedCollaborationModeForContext(
  state: Record<string, CollaborationModeKind>,
  threadId: string,
  mode: CollaborationModeKind,
): Record<string, CollaborationModeKind> {
  const contextId = toThreadContextId(threadId)
  if (isNewThreadContextId(contextId)) {
    return omitStringKeyedRecordKey(state, contextId)
  }
  if (mode === 'plan') {
    const next = cloneStringKeyedRecord(state)
    next[contextId] = 'plan'
    return next
  }
  return omitStringKeyedRecordKey(state, contextId)
}

function saveSelectedCollaborationModeMap(state: Record<string, CollaborationModeKind>): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(state).length === 0) {
      window.localStorage.removeItem(COLLABORATION_MODE_STORAGE_KEY)
    } else {
      window.localStorage.setItem(COLLABORATION_MODE_STORAGE_KEY, JSON.stringify(state))
    }
    window.localStorage.removeItem(LEGACY_COLLABORATION_MODE_STORAGE_KEY)
  } catch {
    // Keep in-memory mode selection working even if localStorage writes fail.
  }
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

function normalizeStoredTokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }

  return null
}

function normalizeTokenUsageBreakdown(value: unknown): UiThreadTokenUsage['last'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  return {
    totalTokens: normalizeStoredTokenCount(record.totalTokens) ?? 0,
    inputTokens: normalizeStoredTokenCount(record.inputTokens) ?? 0,
    cachedInputTokens: normalizeStoredTokenCount(record.cachedInputTokens) ?? 0,
    outputTokens: normalizeStoredTokenCount(record.outputTokens) ?? 0,
    reasoningOutputTokens: normalizeStoredTokenCount(record.reasoningOutputTokens) ?? 0,
  }
}

function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const total = normalizeTokenUsageBreakdown(record.total)
  const last = normalizeTokenUsageBreakdown(record.last)
  if (!total || !last) return null

  const modelContextWindow = normalizeStoredTokenCount(record.modelContextWindow)
  const currentContextTokens = last.totalTokens
  const remainingContextTokens = typeof modelContextWindow === 'number'
    ? Math.max(modelContextWindow - currentContextTokens, 0)
    : null
  const remainingContextPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
    ? clamp(Math.round((remainingContextTokens ?? 0) / modelContextWindow * 100), 0, 100)
    : null

  return {
    total,
    last,
    modelContextWindow,
    currentContextTokens,
    remainingContextTokens,
    remainingContextPercent,
  }
}

function loadThreadTokenUsageMap(): Record<string, UiThreadTokenUsage> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(THREAD_TOKEN_USAGE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, UiThreadTokenUsage> = {}
    for (const [threadId, usage] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId) continue
      const normalizedUsage = normalizeThreadTokenUsage(usage)
      if (normalizedUsage) {
        normalizedMap[threadId] = normalizedUsage
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadTokenUsageMap(state: Record<string, UiThreadTokenUsage>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THREAD_TOKEN_USAGE_STORAGE_KEY, JSON.stringify(state))
}

function loadThreadTerminalOpenMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(THREAD_TERMINAL_OPEN_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, boolean> = {}
    for (const [threadId, isOpen] of Object.entries(parsed as Record<string, unknown>)) {
      if (threadId && typeof isOpen === 'boolean') {
        normalizedMap[threadId] = isOpen
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadTerminalOpenMap(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THREAD_TERMINAL_OPEN_STORAGE_KEY, JSON.stringify(state))
}

function loadSelectedThreadId(): string {
  if (typeof window === 'undefined') return ''
  const raw = window.localStorage.getItem(SELECTED_THREAD_STORAGE_KEY)
  return raw ?? ''
}

function saveSelectedThreadId(threadId: string): void {
  if (typeof window === 'undefined') return
  if (!threadId) {
    window.localStorage.removeItem(SELECTED_THREAD_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_THREAD_STORAGE_KEY, threadId)
}

function loadProjectOrder(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const order: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string' || item.length === 0) continue
      const normalizedItem = toProjectName(item)
      if (normalizedItem.length > 0 && !order.includes(normalizedItem)) {
        order.push(normalizedItem)
      }
    }
    return order
  } catch {
    return []
  }
}

function saveProjectOrder(order: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order))
}

function loadProjectDisplayNames(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(PROJECT_DISPLAY_NAME_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const displayNames: Record<string, string> = {}
    for (const [projectName, displayName] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedProjectName = typeof projectName === 'string' ? toProjectName(projectName) : ''
      if (normalizedProjectName.length > 0 && typeof displayName === 'string') {
        displayNames[normalizedProjectName] = displayName
      }
    }
    return displayNames
  } catch {
    return {}
  }
}

function saveProjectDisplayNames(displayNames: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(displayNames))
}

function mergeProjectOrder(previousOrder: string[], incomingGroups: UiProjectGroup[]): string[] {
  const nextOrder: string[] = []

  for (const projectName of previousOrder) {
    if (!nextOrder.includes(projectName)) {
      nextOrder.push(projectName)
    }
  }

  for (const group of incomingGroups) {
    if (!nextOrder.includes(group.projectName)) {
      nextOrder.push(group.projectName)
    }
  }

  return areStringArraysEqual(previousOrder, nextOrder) ? previousOrder : nextOrder
}

function orderGroupsByProjectOrder(incoming: UiProjectGroup[], projectOrder: string[]): UiProjectGroup[] {
  const incomingByName = new Map(incoming.map((group) => [group.projectName, group]))
  const ordered: UiProjectGroup[] = projectOrder
    .map((projectName) => incomingByName.get(projectName) ?? null)
    .filter((group): group is UiProjectGroup => group !== null)

  for (const group of incoming) {
    if (!projectOrder.includes(group.projectName)) {
      ordered.push(group)
    }
  }

  return ordered
}

function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function reorderStringArray(items: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }

  if (fromIndex === toIndex) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.status === second.status && first.aggregatedOutput === second.aggregatedOutput && first.exitCode === second.exitCode
}

function arePlanStepsEqual(first: UiPlanStep[] = [], second: UiPlanStep[] = []): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index]?.step !== second[index]?.step || first[index]?.status !== second[index]?.status) {
      return false
    }
  }
  return true
}

function arePlanDataEqual(first?: UiPlanData, second?: UiPlanData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.explanation === second.explanation &&
    first.isStreaming === second.isStreaming &&
    arePlanStepsEqual(first.steps, second.steps)
  )
}

function isUnsupportedChatGptModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('not supported when using codex with a chatgpt account') ||
    message.includes('model is not supported') ||
    message.includes('requires a newer version of codex')
  )
}

function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    first.createdAtIso === second.createdAtIso &&
    areStringArraysEqual(first.images, second.images) &&
    areUiFileChangesEqual(first.fileChanges, second.fileChanges) &&
    first.fileChangeStatus === second.fileChangeStatus &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
    arePlanDataEqual(first.plan, second.plan) &&
    first.turnId === second.turnId &&
    first.turnIndex === second.turnIndex &&
    first.isAutomationRun === second.isAutomationRun &&
    first.automationDisplayName === second.automationDisplayName
  )
}

function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean; preserveSteering?: boolean } = {},
): UiMessage[] {
  if (options.preserveSteering) {
    const steering = previous.filter((message) => message.messageType === 'userMessage.optimistic.steer' || message.messageType === 'userMessage.steer')
    incoming = incoming.map((message) => steering.some((previousMessage) => (
      previousMessage.id === message.id
      || (isOptimisticUserMessage(previousMessage)
        && (!previousMessage.turnId || previousMessage.turnId === message.turnId)
        && hasEquivalentUserMessage(previousMessage, [message]))
    )) ? { ...message, messageType: 'userMessage.steer' } : message)
  }
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous
    .map((previousMessage) => {
      const nextMessage = incomingById.get(previousMessage.id)
      if (!nextMessage) {
        return previousMessage
      }
      if (areMessageFieldsEqual(previousMessage, nextMessage)) {
        return previousMessage
      }
      return nextMessage
    })
    .filter((message) => !isOptimisticUserMessage(message) || !hasEquivalentUserMessage(message, incoming))

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const merged = [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function areUiFileChangesEqual(first?: UiFileChange[], second?: UiFileChange[]): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    const firstChange = first[index]
    const secondChange = second[index]
    if (
      firstChange.path !== secondChange.path ||
      firstChange.operation !== secondChange.operation ||
      firstChange.movedToPath !== secondChange.movedToPath ||
      firstChange.diff !== secondChange.diff ||
      firstChange.addedLineCount !== secondChange.addedLineCount ||
      firstChange.removedLineCount !== secondChange.removedLineCount
    ) {
      return false
    }
  }
  return true
}

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function isOptimisticUserMessage(message: UiMessage): boolean {
  return message.messageType === 'userMessage.optimistic' || message.messageType === 'userMessage.optimistic.steer'
}

function hasOptimisticUserMessages(messages: UiMessage[]): boolean {
  return messages.some(isOptimisticUserMessage)
}

function hasEquivalentUserMessage(target: UiMessage, messages: UiMessage[]): boolean {
  if (target.role !== 'user') return false
  const targetText = normalizeMessageText(target.text)
  const targetImages = Array.isArray(target.images) ? target.images : []
  const targetFileCount = Array.isArray(target.fileAttachments) ? target.fileAttachments.length : 0
  const targetSkillCount = Array.isArray(target.skills) ? target.skills.length : 0

  return messages.some((message) => {
    if (message === target || message.role !== 'user' || isOptimisticUserMessage(message)) return false
    const messageText = normalizeMessageText(message.text)
    const messageImages = Array.isArray(message.images) ? message.images : []
    const messageFileCount = Array.isArray(message.fileAttachments) ? message.fileAttachments.length : 0
    const messageSkillCount = Array.isArray(message.skills) ? message.skills.length : 0
    return (
      messageText === targetText &&
      areStringArraysEqual(messageImages, targetImages) &&
      messageFileCount === targetFileCount &&
      messageSkillCount === targetSkillCount
    )
  })
}

function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingMessageIds = new Set(incoming.map((message) => message.id))
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingAssistantTexts.size === 0) {
    return previous
  }

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    if (incomingMessageIds.has(message.id)) return false
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingAssistantTexts.has(normalized)
  })

  return next.length === previous.length ? previous : next
}

function removePersistedLiveMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingIds = new Set(incoming.map((message) => message.id))
  const next = previous.filter((message) => !incomingIds.has(message.id))
  return next.length === previous.length ? previous : next
}

function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  const createdAtIso = existingIndex >= 0
    ? previous[existingIndex].createdAtIso
    : nextMessage.createdAtIso
  const stampedMessage = {
    ...nextMessage,
    createdAtIso: createdAtIso || new Date().toISOString(),
  }
  if (existingIndex < 0) {
    return [...previous, stampedMessage]
  }

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, stampedMessage)) {
    return previous
  }

  const next = [...previous]
  next.splice(existingIndex, 1, stampedMessage)
  return next
}

type TurnSummaryState = {
  turnId: string
  durationMs: number
  completedAtIso: string
  outputTokens?: number
  inputTokens?: number
  reasoningOutputTokens?: number
  prefillDurationMs?: number
  decodeDurationMs?: number
  decodeSegmentCount?: number
}

type TurnTokenThroughputState = {
  turnId: string
  priorTurnId: string | null
  baselineOutputTokens: number | null
  outputTokens: number | null
  inputTokens: number | null
  reasoningOutputTokens: number | null
  prefillDurationMs: number | null
  decodeMessageId: string | null
  decodeLastDeltaAtMs: number | null
  decodeDurationMs: number
  decodeSegmentCount: number
  phase: 'inferBaseline' | 'observeBaseline' | 'tracking' | 'invalid'
}

type ThreadTokenUsageUpdate = {
  threadId: string
  turnId: string
  usage: UiThreadTokenUsage
}

type TurnActivityState = {
  label: string
  details: string[]
}

type TurnErrorState = {
  message: string
  transient: boolean
}

type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type TurnCompletedInfo = {
  threadId: string
  turnId: string
  status: TurnTerminalStatus
  completedAtMs: number
  startedAtMs?: number
}

const WORKED_MESSAGE_TYPE = 'worked'

function loadTurnSummaries(): Record<string, TurnSummaryState[]> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TURN_SUMMARIES_STORAGE_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result = createStringKeyedRecord<TurnSummaryState[]>()
    for (const [threadId, entries] of Object.entries(parsed)) {
      if (!threadId || !Array.isArray(entries)) continue
      const summaries = entries.filter((entry): entry is TurnSummaryState => (
        entry !== null && typeof entry === 'object' &&
        typeof entry.turnId === 'string' && entry.turnId.length > 0 &&
        typeof entry.completedAtIso === 'string' && !Number.isNaN(Date.parse(entry.completedAtIso)) &&
        typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) && entry.durationMs >= 0 &&
        (entry.outputTokens === undefined || (Number.isSafeInteger(entry.outputTokens) && entry.outputTokens > 0)) &&
        (entry.inputTokens === undefined || (Number.isSafeInteger(entry.inputTokens) && entry.inputTokens >= 0)) &&
        (entry.reasoningOutputTokens === undefined || (Number.isSafeInteger(entry.reasoningOutputTokens) && entry.reasoningOutputTokens >= 0)) &&
        (entry.prefillDurationMs === undefined || (Number.isFinite(entry.prefillDurationMs) && entry.prefillDurationMs >= 0)) &&
        (entry.decodeDurationMs === undefined || (Number.isFinite(entry.decodeDurationMs) && entry.decodeDurationMs >= 0)) &&
        (entry.decodeSegmentCount === undefined || (Number.isSafeInteger(entry.decodeSegmentCount) && entry.decodeSegmentCount >= 0))
      ))
      if (summaries.length) result[threadId] = summaries.slice(-MAX_SAVED_TURN_SUMMARIES_PER_THREAD)
    }
    return result
  } catch {
    return {}
  }
}

function saveTurnSummaries(summaries: Record<string, TurnSummaryState[]>): void {
  try {
    window.localStorage.setItem(TURN_SUMMARIES_STORAGE_KEY, JSON.stringify(summaries))
  } catch {
    // Keep the in-memory records when storage is unavailable.
  }
}

function parseIsoTimestamp(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  const displaySeconds = seconds > 0 || parts.length === 0 ? seconds : 0
  parts.push(`${displaySeconds}s`)
  return parts.join(' ')
}

function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.turnId === second.turnId &&
    first.durationMs === second.durationMs &&
    first.completedAtIso === second.completedAtIso &&
    first.outputTokens === second.outputTokens &&
    first.inputTokens === second.inputTokens &&
    first.reasoningOutputTokens === second.reasoningOutputTokens &&
    first.prefillDurationMs === second.prefillDurationMs &&
    first.decodeDurationMs === second.decodeDurationMs &&
    first.decodeSegmentCount === second.decodeSegmentCount
  )
}

function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.label !== second.label) return false
  if (first.details.length !== second.details.length) return false
  for (let index = 0; index < first.details.length; index += 1) {
    if (first.details[index] !== second.details[index]) return false
  }
  return true
}

function buildTurnSummaryMessage(summary: TurnSummaryState): UiMessage {
  return {
    id: `turn-summary:${summary.turnId}`,
    role: 'system',
    text: `Worked for ${formatTurnDuration(summary.durationMs)}`,
    createdAtIso: summary.completedAtIso,
    messageType: WORKED_MESSAGE_TYPE,
    turnId: summary.turnId,
  }
}

function findLastAssistantMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index
    }
  }
  return -1
}

function insertTurnSummaryMessages(messages: UiMessage[], summaries: TurnSummaryState[], current?: TurnSummaryState): UiMessage[] {
  const lastAssistantByTurnId = new Map<string, number>()
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role === 'assistant' && messages[index].turnId) {
      lastAssistantByTurnId.set(messages[index].turnId!, index)
    }
  }
  const summaryByIndex = new Map<number, TurnSummaryState>()
  for (const summary of summaries) {
    const index = lastAssistantByTurnId.get(summary.turnId)
    if (index !== undefined) summaryByIndex.set(index, summary)
  }
  if (current && !lastAssistantByTurnId.has(current.turnId)) {
    const lastAssistantIndex = findLastAssistantMessageIndex(messages)
    summaryByIndex.set(lastAssistantIndex >= 0 && !messages[lastAssistantIndex].turnId ? lastAssistantIndex : messages.length, current)
  }
  const result: UiMessage[] = []
  for (let index = 0; index <= messages.length; index += 1) {
    const summary = summaryByIndex.get(index)
    if (summary) result.push(buildTurnSummaryMessage(summary))
    if (index < messages.length && messages[index].messageType !== WORKED_MESSAGE_TYPE) {
      const message = messages[index]
      result.push(summary && message.role === 'assistant' && !message.createdAtIso
        ? { ...message, createdAtIso: summary.completedAtIso }
        : message)
    }
  }
  return result
}

function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function omitKeys<TValue>(record: Record<string, TValue>, keys: Set<string>): Record<string, TValue> {
  if (keys.size === 0) return record
  let changed = false
  const next: Record<string, TValue> = {}
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      changed = true
      continue
    }
    next[key] = value
  }
  return changed ? next : record
}

function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return (
    first.id === second.id &&
    first.title === second.title &&
    first.projectName === second.projectName &&
    first.cwd === second.cwd &&
    first.createdAtIso === second.createdAtIso &&
    first.updatedAtIso === second.updatedAtIso &&
    first.preview === second.preview &&
    first.unread === second.unread &&
    first.inProgress === second.inProgress &&
    first.pendingRequestState === second.pendingRequestState
  )
}

function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  const nextEntries = Object.entries(stateMap).filter(([threadId]) => threadIds.has(threadId))
  if (nextEntries.length === Object.keys(stateMap).length) {
    return stateMap
  }
  return Object.fromEntries(nextEntries) as Record<string, T>
}

export function removeThreadFromGroups(groups: UiProjectGroup[], threadId: string): UiProjectGroup[] {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return groups

  let changed = false
  const nextGroups: UiProjectGroup[] = []

  for (const group of groups) {
    const nextThreads = group.threads.filter((thread) => thread.id !== normalizedThreadId)
    const removedFromGroup = nextThreads.length !== group.threads.length
    if (removedFromGroup) {
      changed = true
    }
    if (nextThreads.length > 0) {
      nextGroups.push(removedFromGroup ? { ...group, threads: nextThreads } : group)
    } else if (group.threads.length === 0) {
      nextGroups.push(group)
    }
  }

  return changed ? nextGroups : groups
}

function mergeThreadGroups(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
): UiProjectGroup[] {
  const previousGroupsByName = new Map(previous.map((group) => [group.projectName, group]))
  const mergedGroups: UiProjectGroup[] = incoming.map((incomingGroup) => {
    const previousGroup = previousGroupsByName.get(incomingGroup.projectName)
    const previousThreadsById = new Map(previousGroup?.threads.map((thread) => [thread.id, thread]) ?? [])

    const mergedThreads = incomingGroup.threads.map((incomingThread) => {
      const previousThread = previousThreadsById.get(incomingThread.id)
      if (previousThread && areThreadFieldsEqual(previousThread, incomingThread)) {
        return previousThread
      }
      return incomingThread
    })

    if (
      previousGroup &&
      previousGroup.projectName === incomingGroup.projectName &&
      areThreadArraysEqual(previousGroup.threads, mergedThreads)
    ) {
      return previousGroup
    }

    return {
      projectName: incomingGroup.projectName,
      threads: mergedThreads,
    }
  })

  return areGroupArraysEqual(previous, mergedGroups) ? previous : mergedGroups
}

function mergeIncomingWithLocalInProgressThreads(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
  inProgressById: Record<string, boolean>,
): UiProjectGroup[] {
  const incomingThreadIds = new Set(flattenThreads(incoming).map((thread) => thread.id))
  const localInProgressThreads = flattenThreads(previous).filter(
    (thread) => inProgressById[thread.id] === true && !incomingThreadIds.has(thread.id),
  )

  if (localInProgressThreads.length === 0) {
    return incoming
  }

  const incomingByProjectName = new Map(incoming.map((group) => [group.projectName, group]))
  const merged: UiProjectGroup[] = incoming.map((group) => ({
    projectName: group.projectName,
    threads: [...group.threads],
  }))

  for (const thread of localInProgressThreads) {
    const existingGroup = incomingByProjectName.get(thread.projectName)
    if (existingGroup) {
      const mergedGroupIndex = merged.findIndex((group) => group.projectName === thread.projectName)
      if (mergedGroupIndex >= 0) {
        merged[mergedGroupIndex] = {
          projectName: merged[mergedGroupIndex].projectName,
          threads: [thread, ...merged[mergedGroupIndex].threads],
        }
      }
      continue
    }

    merged.push({
      projectName: thread.projectName,
      threads: [thread],
    })
  }

  return merged
}

function toProjectNameFromWorkspaceRoot(value: string): string {
  return toProjectName(value)
}

function getRemoteProjectHostLabel(hostId: string): string {
  const normalized = hostId.trim()
  if (!normalized) return ''
  const separatorIndex = normalized.lastIndexOf(':')
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized
}

function getRemoteProjectDisplayName(remoteProject: NonNullable<WorkspaceRootsState['remoteProjects']>[number]): string {
  const label = remoteProject.label || toProjectName(remoteProject.remotePath) || remoteProject.id
  const hostLabel = getRemoteProjectHostLabel(remoteProject.hostId)
  return hostLabel ? `${label} ${hostLabel}` : label
}

function getRemoteProjectById(rootsState: WorkspaceRootsState | null): Map<string, NonNullable<WorkspaceRootsState['remoteProjects']>[number]> {
  const remoteProjects = rootsState?.remoteProjects ?? []
  return new Map(remoteProjects.map((project) => [project.id, project]))
}

function getWorkspaceProjectOrderPaths(rootsState: WorkspaceRootsState | null): string[] {
  if (!rootsState) return []
  const savedRoots = new Set(rootsState.order)
  const remoteProjectIds = new Set((rootsState.remoteProjects ?? []).map((project) => project.id))
  const orderedRoots = rootsState.projectOrder.filter((item) => savedRoots.has(item) || remoteProjectIds.has(item))
  for (const rootPath of rootsState.order) {
    if (!orderedRoots.includes(rootPath)) orderedRoots.push(rootPath)
  }
  for (const remoteProjectId of remoteProjectIds) {
    if (!orderedRoots.includes(remoteProjectId)) orderedRoots.push(remoteProjectId)
  }
  return orderedRoots
}

function getWorkspaceProjectOrderNames(
  rootsState: WorkspaceRootsState | null,
  duplicateLeafNames: Set<string>,
): string[] {
  const remoteProjectsById = getRemoteProjectById(rootsState)
  return getWorkspaceProjectOrderPaths(rootsState).map((rootPath) => {
    if (remoteProjectsById.has(rootPath)) return rootPath
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    const leafName = toProjectNameFromWorkspaceRoot(normalizedRootPath)
    return duplicateLeafNames.has(leafName) ? normalizedRootPath : leafName
  })
}

function matchesWorkspaceRootProject(rootPath: string, projectName: string): boolean {
  const normalizedRootPath = normalizePathForUi(rootPath).trim()
  return normalizedRootPath === projectName || toProjectNameFromWorkspaceRoot(rootPath) === projectName
}

export function collectWorkspaceRootPathsForProjectRemoval(
  rootsState: WorkspaceRootsState,
  projectName: string,
): Set<string> {
  const removedRootPaths = new Set<string>()
  for (const rootPath of rootsState.order) {
    if (matchesWorkspaceRootProject(rootPath, projectName)) {
      removedRootPaths.add(rootPath)
    }
  }
  for (const rootPath of rootsState.active) {
    if (matchesWorkspaceRootProject(rootPath, projectName)) {
      removedRootPaths.add(rootPath)
    }
  }
  for (const rootPath of Object.keys(rootsState.labels)) {
    if (matchesWorkspaceRootProject(rootPath, projectName)) {
      removedRootPaths.add(rootPath)
    }
  }
  return removedRootPaths
}

export function buildWorkspaceRootsProjectOrderState(
  rootsState: WorkspaceRootsState,
  orderedProjectNames: string[],
  groups: UiProjectGroup[],
): Pick<WorkspaceRootsState, 'order' | 'active' | 'projectOrder'> {
  const remoteProjectIds = new Set((rootsState.remoteProjects ?? []).map((project) => project.id))
  const rootByProjectName = new Map<string, string>()
  const groupRootPaths = new Set<string>()
  for (const rootPath of rootsState.order) {
    const projectName = toProjectNameFromWorkspaceRoot(rootPath)
    if (!rootByProjectName.has(projectName)) {
      rootByProjectName.set(projectName, rootPath)
    }
  }
  for (const group of groups) {
    const cwd = group.threads.find((thread) => {
      const path = thread.cwd.trim()
      return path.length > 0 && !isProjectlessChatPath(path)
    })?.cwd.trim() ?? ''
    if (!cwd) continue
    rootByProjectName.set(group.projectName, cwd)
    groupRootPaths.add(cwd)
  }

  const nextProjectOrder: string[] = []
  const pushProjectOrderItem = (item: string): void => {
    if (item && !nextProjectOrder.includes(item)) {
      nextProjectOrder.push(item)
    }
  }

  for (const projectName of orderedProjectNames) {
    if (remoteProjectIds.has(projectName)) {
      pushProjectOrderItem(projectName)
      continue
    }
    const rootPath = rootByProjectName.get(projectName)
    if (rootPath) {
      pushProjectOrderItem(rootPath)
    }
  }
  for (const item of getWorkspaceProjectOrderPaths(rootsState)) {
    pushProjectOrderItem(item)
  }

  const nextOrder = nextProjectOrder.filter((item) => rootsState.order.includes(item) || groupRootPaths.has(item))
  for (const rootPath of rootsState.order) {
    if (!nextOrder.includes(rootPath)) {
      nextOrder.push(rootPath)
    }
  }

  const nextActive = rootsState.active.filter((rootPath) => nextOrder.includes(rootPath))
  if (nextActive.length === 0 && nextOrder.length > 0) {
    nextActive.push(nextOrder[0])
  }

  return {
    order: nextOrder,
    active: nextActive,
    projectOrder: nextProjectOrder,
  }
}

function orderGroupsByWorkspaceProjectOrder(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
  duplicateLeafNames: Set<string>,
): UiProjectGroup[] {
  const order = getWorkspaceProjectOrderNames(rootsState, duplicateLeafNames)
  if (order.length === 0) return groups
  const orderIndexByName = new Map(order.map((name, index) => [name, index]))
  return [...groups].sort((first, second) => {
    if (isProjectlessGroup(first) || isProjectlessGroup(second)) return 0
    const firstIndex = orderIndexByName.get(first.projectName) ?? Number.POSITIVE_INFINITY
    const secondIndex = orderIndexByName.get(second.projectName) ?? Number.POSITIVE_INFINITY
    if (firstIndex === secondIndex) return 0
    return firstIndex - secondIndex
  })
}

function collectDuplicateProjectLeafNames(groups: UiProjectGroup[], rootsState: WorkspaceRootsState | null): Set<string> {
  const rootByLeafName = new Map<string, Set<string>>()
  const canonicalWorkspaceRootCountsByLeafName = new Map<string, number>()
  const addPath = (value: string): void => {
    const normalizedPath = normalizePathForUi(value).trim()
    if (!normalizedPath) return
    const leafName = toProjectName(normalizedPath)
    const existing = rootByLeafName.get(leafName) ?? new Set<string>()
    existing.add(normalizedPath)
    rootByLeafName.set(leafName, existing)
  }

  for (const rootPath of rootsState?.order ?? []) {
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    if (!normalizedRootPath) continue
    const leafName = toProjectName(normalizedRootPath)
    if (!isManagedCodexWorktreePath(normalizedRootPath)) {
      canonicalWorkspaceRootCountsByLeafName.set(leafName, (canonicalWorkspaceRootCountsByLeafName.get(leafName) ?? 0) + 1)
    }
    addPath(rootPath)
  }
  for (const group of groups) {
    for (const thread of group.threads) {
      const normalizedCwd = normalizePathForUi(thread.cwd).trim()
      const leafName = toProjectName(normalizedCwd)
      const isRegisteredRoot = rootsState?.order.some((rootPath) => normalizePathForUi(rootPath).trim() === normalizedCwd) === true
      if (isManagedCodexWorktreePath(normalizedCwd) && !isRegisteredRoot && canonicalWorkspaceRootCountsByLeafName.get(leafName) === 1) continue
      addPath(thread.cwd)
    }
  }

  const duplicateLeafNames = new Set<string>()
  for (const [leafName, paths] of rootByLeafName.entries()) {
    if (paths.size > 1) duplicateLeafNames.add(leafName)
  }
  return duplicateLeafNames
}

function isManagedCodexWorktreePath(value: string): boolean {
  return value.includes('/.codex/worktrees/')
}

function disambiguateProjectGroupsByCwd(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
): UiProjectGroup[] {
  const duplicateLeafNames = collectDuplicateProjectLeafNames(groups, rootsState)
  if (duplicateLeafNames.size === 0) return groups

  const uniqueCanonicalWorkspaceRootLeafNames = new Set<string>()
  const duplicateCanonicalWorkspaceRootLeafNames = new Set<string>()
  const canonicalWorkspaceRootByLeafName = new Map<string, string>()
  const registeredWorkspaceRoots = new Set<string>()
  for (const rootPath of rootsState?.order ?? []) {
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    if (!normalizedRootPath) continue
    registeredWorkspaceRoots.add(normalizedRootPath)
    if (isManagedCodexWorktreePath(normalizedRootPath)) continue
    const leafName = toProjectName(normalizedRootPath)
    if (uniqueCanonicalWorkspaceRootLeafNames.has(leafName)) {
      uniqueCanonicalWorkspaceRootLeafNames.delete(leafName)
      duplicateCanonicalWorkspaceRootLeafNames.add(leafName)
      canonicalWorkspaceRootByLeafName.delete(leafName)
    } else if (!duplicateCanonicalWorkspaceRootLeafNames.has(leafName)) {
      uniqueCanonicalWorkspaceRootLeafNames.add(leafName)
      canonicalWorkspaceRootByLeafName.set(leafName, normalizedRootPath)
    }
  }

  const disambiguatedGroups: UiProjectGroup[] = []
  const groupsByProjectName = new Map<string, UiProjectGroup>()
  for (const group of groups) {
    for (const thread of group.threads) {
      const normalizedCwd = normalizePathForUi(thread.cwd).trim()
      const leafName = toProjectName(normalizedCwd)
      const isRegisteredRoot = registeredWorkspaceRoots.has(normalizedCwd)
      const isCanonicalWorktreeThread = isManagedCodexWorktreePath(normalizedCwd)
        && !isRegisteredRoot
        && uniqueCanonicalWorkspaceRootLeafNames.has(leafName)
      let projectName = group.projectName
      if (isCanonicalWorktreeThread && duplicateLeafNames.has(leafName)) {
        projectName = canonicalWorkspaceRootByLeafName.get(leafName) ?? group.projectName
      } else if (normalizedCwd && duplicateLeafNames.has(leafName)) {
        projectName = normalizedCwd
      }
      const nextThread = thread.projectName === projectName ? thread : { ...thread, projectName }
      const existingGroup = groupsByProjectName.get(projectName)
      if (existingGroup) {
        existingGroup.threads.push(nextThread)
      } else {
        const nextGroup = { projectName, threads: [nextThread] }
        groupsByProjectName.set(projectName, nextGroup)
        disambiguatedGroups.push(nextGroup)
      }
    }
  }

  return disambiguatedGroups
}

function addWorkspaceRootPlaceholderGroups(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
  duplicateLeafNames: Set<string>,
): UiProjectGroup[] {
  if (!rootsState || (rootsState.order.length === 0 && (rootsState.remoteProjects ?? []).length === 0)) return groups
  const existingProjectNames = new Set(groups.map((group) => group.projectName))
  const nextGroups = [...groups]
  const remoteProjectsById = getRemoteProjectById(rootsState)

  for (const rootPath of getWorkspaceProjectOrderPaths(rootsState)) {
    if (remoteProjectsById.has(rootPath)) {
      if (existingProjectNames.has(rootPath)) continue
      nextGroups.push({ projectName: rootPath, threads: [] })
      existingProjectNames.add(rootPath)
      continue
    }
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    if (!normalizedRootPath) continue
    const leafName = toProjectNameFromWorkspaceRoot(normalizedRootPath)
    const projectName = duplicateLeafNames.has(leafName) ? normalizedRootPath : leafName
    if (existingProjectNames.has(projectName)) continue
    nextGroups.push({ projectName, threads: [] })
    existingProjectNames.add(projectName)
  }

  return nextGroups
}

function toOptimisticThreadTitle(message: string): string {
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) return 'Untitled thread'
  return firstLine.slice(0, 80)
}

function toForkedThreadTitle(title: string): string {
  const normalizedTitle = title.trim() || 'Untitled thread'
  return /^fork:\s+/iu.test(normalizedTitle) ? normalizedTitle : `Fork: ${normalizedTitle}`
}

function isProjectlessGroup(group: UiProjectGroup): boolean {
  return group.threads.some((thread) => thread.cwd.trim().length === 0 || isProjectlessChatPath(thread.cwd))
}

export function filterGroupsByWorkspaceRoots(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
): UiProjectGroup[] {
  const duplicateLeafNames = collectDuplicateProjectLeafNames(groups, rootsState)
  const disambiguatedGroups = disambiguateProjectGroupsByCwd(groups, rootsState)
  const groupsWithWorkspaceRoots = addWorkspaceRootPlaceholderGroups(disambiguatedGroups, rootsState, duplicateLeafNames)
  if (!rootsState || (rootsState.order.length === 0 && (rootsState.remoteProjects ?? []).length === 0)) return groupsWithWorkspaceRoots
  const allowedProjectNames = new Set<string>()
  for (const projectName of getWorkspaceProjectOrderNames(rootsState, duplicateLeafNames)) {
    allowedProjectNames.add(projectName)
  }
  const filteredGroups = groupsWithWorkspaceRoots.filter((group) => allowedProjectNames.has(group.projectName) || isProjectlessGroup(group))
  return orderGroupsByWorkspaceProjectOrder(filteredGroups, rootsState, duplicateLeafNames)
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const persistedMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const livePlanMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveAgentMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveReasoningTextByThreadId = ref<Record<string, string>>({})
  const liveCommandsByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveFileChangeMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const subagentsByParentThreadId = ref<Record<string, UiSubagent[]>>({})
  const inProgressById = ref<Record<string, boolean>>({})
  const threadGoalByThreadId = ref<Record<string, UiThreadGoal>>({})
  const threadGoalObservedAtByThreadId = ref<Record<string, number>>({})
  const threadGoalLoadingByThreadId = ref<Record<string, boolean>>({})
  const threadGoalUpdatingByThreadId = ref<Record<string, boolean>>({})
  const threadGoalErrorByThreadId = ref<Record<string, string>>({})
  type FileAttachment = { label: string; path: string; fsPath: string }
  type QueuedMessage = {
    id: string
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    collaborationMode: CollaborationModeKind
  }
  type PendingTurnRequest = {
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    effort: ReasoningEffort | ''
    collaborationMode: CollaborationModeKind
    fallbackRetried: boolean
  }
  const queuedMessagesByThreadId = ref<Record<string, QueuedMessage[]>>({})
  const queueProcessingByThreadId = ref<Record<string, boolean>>({})
  let hasLoadedPersistedQueueState = false
  const eventUnreadByThreadId = ref<Record<string, boolean>>({})
  const availableModelIds = ref<string[]>([])
  const availableModelReasoningEfforts = ref<Record<string, ReasoningEffort[]>>({})
  const availableCollaborationModes = ref<CollaborationModeOption[]>([
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan' },
  ])
  const selectedCollaborationModeByContext = ref<Record<string, CollaborationModeKind>>(
    loadSelectedCollaborationModeMap(),
  )
  const selectedModelIdByContext = ref<Record<string, string>>(loadSelectedModelMap())
  const selectedReasoningEffortByContext = ref<Record<string, ReasoningEffort>>(
    loadSelectedReasoningEffortMap(),
  )
  const selectedCollaborationMode = ref<CollaborationModeKind>(
    readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value),
  )
  const selectedModelId = ref(readSelectedModel(selectedModelIdByContext.value, selectedThreadId.value))
  const selectedReasoningEffort = ref<ReasoningEffort | ''>(
    readSelectedReasoningEffort(selectedReasoningEffortByContext.value, selectedThreadId.value) || 'medium',
  )
  const selectedSpeedMode = ref<SpeedMode>('standard')
  const activeProviderId = ref('')
  const activeRuntimeProviderId = ref('')
  let modelPreferencesRequestEpoch = 0
  const codexCliMissingError = ref('')
  const readStateByThreadId = ref<Record<string, string>>(loadReadStateMap())
  const unreadCutoffIso = ref(loadUnreadCutoffIso())
  const projectOrder = ref<string[]>(loadProjectOrder())
  const projectDisplayNameById = ref<Record<string, string>>(loadProjectDisplayNames())
  const loadedVersionByThreadId = ref<Record<string, string>>({})
  const loadedMessagesByThreadId = ref<Record<string, boolean>>({})
  const hasMoreOlderMessagesByThreadId = ref<Record<string, boolean>>({})
  const loadingOlderMessagesByThreadId = ref<Record<string, boolean>>({})
  const resumedThreadById = ref<Record<string, boolean>>({})
  const turnIndexByTurnIdByThreadId = ref<Record<string, Record<string, number>>>({})
  const turnSummaryByThreadId = ref<Record<string, TurnSummaryState>>({})
  const savedTurnSummariesByThreadId = ref<Record<string, TurnSummaryState[]>>(loadTurnSummaries())
  const turnActivityByThreadId = ref<Record<string, TurnActivityState>>({})
  const turnErrorByThreadId = ref<Record<string, TurnErrorState>>({})
  const activeTurnIdByThreadId = ref<Record<string, string>>({})
  const interruptBlockedUntilPersistedByThreadId = ref<Record<string, boolean>>({})
  const threadListedByServerById = ref<Record<string, boolean>>({})
  const persistedUserMessageByThreadId = ref<Record<string, boolean>>({})
  const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({})
  let pendingServerRequestsRevision = 0
  const pendingTurnRequestByThreadId = ref<Record<string, PendingTurnRequest>>({})
  const codexRateLimit = ref<UiRateLimitSnapshot | null>(null)
  const threadTokenUsageByThreadId = ref<Record<string, UiThreadTokenUsage>>(loadThreadTokenUsageMap())
  const terminalOpenByThreadId = ref<Record<string, boolean>>(loadThreadTerminalOpenMap())
  const threadModelProviderByThreadId = ref<Record<string, string>>({})
  const activeAccountStorageId = ref(DEFAULT_ACCOUNT_STORAGE_ID)
  const sideConversationParentThreadId = ref('')
  const sideConversationThreadId = ref('')
  const sideConversationQueuedMessages = ref<QueuedMessage[]>([])
  const isSideConversationVisible = ref(false)
  const sideConversationError = ref('')
  const isSideConversationOpening = ref(false)
  const sideConversationModelId = ref('')
  const sideConversationReasoningEffort = ref<ReasoningEffort | ''>('')
  const sideConversationCollaborationMode = ref<CollaborationModeKind>('default')
  let sideConversationTurnStartPromise: Promise<string> | null = null
  const sideConversationPendingTurnStarts = new Set<Promise<string>>()
  let sideConversationEpoch = 0
  let sideConversationFirstTurnIndex = 0
  const sideConversationTurnIds = new Set<string>()
  const sideConversationCompletedTurnIds = new Set<string>()
  const discardedSideConversationThreadIds = new Set<string>()

  const threadTitleById = ref<Record<string, string>>({})

  const installedSkills = ref<SkillInfo[]>([])
  const accountRateLimitSnapshots = ref<UiRateLimitSnapshot[]>([])

  const isLoadingThreads = ref(false)
  const loadingMessagesByThreadId = ref<Record<string, boolean>>({})
  const isLoadingMessages = computed(() => (
    loadingMessagesByThreadId.value[selectedThreadId.value] === true
    && loadedMessagesByThreadId.value[selectedThreadId.value] !== true
  ))
  const isThreadListFullyLoaded = ref(false)
  const isSendingMessage = ref(false)
  const isInterruptingTurn = ref(false)
  const isUpdatingSpeedMode = ref(false)
  const isRollingBack = ref(false)

  const error = ref('')
  const isPolling = ref(false)
  const hasLoadedThreads = ref(false)

  function extractLocalImagePathFromUrl(value: string): string {
    try {
      const parsed = new URL(value, 'http://localhost')
      if (parsed.pathname !== '/codex-local-image') return ''
      return parsed.searchParams.get('path')?.trim() ?? ''
    } catch {
      return ''
    }
  }

  function shouldReuseAttachedImageFromPrompt(promptText: string): boolean {
    const normalized = promptText.trim().toLowerCase()
    if (!normalized) return false
    return /\b(attached image|attached screenshot|save the attached|copy (the )?screenshot|save screenshot)\b/i.test(normalized)
  }

  function findLatestUserLocalImageUrl(threadId: string): string {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    for (let index = persisted.length - 1; index >= 0; index -= 1) {
      const message = persisted[index]
      if (message.role !== 'user' || !Array.isArray(message.images) || message.images.length === 0) continue
      for (let imageIndex = message.images.length - 1; imageIndex >= 0; imageIndex -= 1) {
        const imageUrl = message.images[imageIndex]?.trim() ?? ''
        if (!imageUrl) continue
        if (extractLocalImagePathFromUrl(imageUrl)) return imageUrl
      }
    }
    return ''
  }
  let stopNotificationStream: (() => void) | null = null
  let eventSyncTimer: number | null = null
  let pendingServerRequestSnapshotRetryTimer: number | null = null
  let pendingServerRequestSnapshotPromise: Promise<void> | null = null
  let pollingEpoch = 0
  let rateLimitRefreshTimer: number | null = null
  const delayedTurnSyncTimerByThreadId = new Map<string, number>()
  let loadThreadsPromise: Promise<void> | null = null
  const loadMessagePromiseByThreadId = new Map<string, Promise<void>>()
  let refreshSkillsPromise: Promise<void> | null = null
  let lastThreadListLoadAt = 0
  let hasLoadedSkills = false
  let lastSkillsLoadAt = 0
  let lastSkillsLoadKey = ''
  let rateLimitRefreshPromise: Promise<void> | null = null
  let pendingThreadsRefresh = false
  let pendingThreadsRefreshForce = false
  const pendingThreadMessageRefresh = new Set<string>()
  const pendingSubagentParentRefresh = new Set<string>()
  const lastMessageLoadAtByThreadId = new Map<string, number>()
  const lastMessageLoadFailureAtByThreadId = new Map<string, number>()
  let threadListNextCursor: string | null = null
  let threadListBackgroundTimer: number | null = null
  let isLoadingRemainingThreadPages = false
  let hasLoadedAllThreadPages = false
  let loadedThreadListGroups: UiProjectGroup[] = []
  let loadedThreadListRootsState: WorkspaceRootsState | null = null
  let hasHydratedWorkspaceRootsState = false
  const activeReasoningItemIdByThreadId = new Map<string, string>()
  let shouldAutoScrollOnNextAgentEvent = false
  const pendingTurnStartsById = new Map<string, TurnStartedInfo>()
  const turnTokenThroughputByThreadId = new Map<string, TurnTokenThroughputState>()
  const turnTokenThroughputRevision = ref(0)
  const threadGoalRequestByThreadId = new Map<string, Promise<void>>()
  const threadGoalRevisionByThreadId = new Map<string, number>()
  const loadedThreadGoalIds = new Set<string>()
  let threadGoalRequestEpoch = 0
  const fallbackRetryInFlightThreadIds = new Set<string>()
  const nonSuccessCompletionReadBaselineByThreadId = new Map<string, string>()

  function rememberObservedTurnStart(threadId: string, turnId: string, recovered = false): void {
    if (!turnId) return
    startTurnTokenThroughput(threadId, turnId, recovered)
    if (pendingTurnStartsById.has(turnId)) return
    pendingTurnStartsById.set(turnId, { threadId, turnId, startedAtMs: Date.now() })
  }

  function startTurnTokenThroughput(threadId: string, turnId: string, recovered = false): void {
    if (!threadId || !turnId) return
    const existing = turnTokenThroughputByThreadId.get(threadId)
    if (existing?.turnId === turnId) return

    const baselineOutputTokens = recovered
      ? null
      : threadTokenUsageByThreadId.value[threadId]?.total.outputTokens ?? null
    turnTokenThroughputByThreadId.set(threadId, {
      turnId,
      priorTurnId: existing?.turnId ?? null,
      baselineOutputTokens,
      outputTokens: null,
      inputTokens: null,
      reasoningOutputTokens: null,
      prefillDurationMs: null,
      decodeMessageId: null,
      decodeLastDeltaAtMs: null,
      decodeDurationMs: 0,
      decodeSegmentCount: 0,
      phase: recovered ? 'observeBaseline' : baselineOutputTokens === null ? 'inferBaseline' : 'tracking',
    })
    turnTokenThroughputRevision.value += 1
  }

  function observeTurnTextDelta(threadId: string, turnId: string, messageId: string): void {
    const tracker = turnTokenThroughputByThreadId.get(threadId)
    if (!tracker || tracker.turnId !== turnId || !messageId) return
    const observedAtMs = Date.now()
    const isNewSegment = tracker.decodeMessageId !== messageId
    const startedAtMs = pendingTurnStartsById.get(turnId)?.startedAtMs
    turnTokenThroughputByThreadId.set(threadId, {
      ...tracker,
      prefillDurationMs: tracker.prefillDurationMs ?? (
        typeof startedAtMs === 'number' ? Math.max(0, observedAtMs - startedAtMs) : null
      ),
      decodeMessageId: messageId,
      decodeLastDeltaAtMs: observedAtMs,
      decodeDurationMs: !isNewSegment && tracker.decodeLastDeltaAtMs !== null
        ? tracker.decodeDurationMs + Math.max(0, observedAtMs - tracker.decodeLastDeltaAtMs)
        : tracker.decodeDurationMs,
      decodeSegmentCount: tracker.decodeSegmentCount + (isNewSegment ? 1 : 0),
    })
    turnTokenThroughputRevision.value += 1
  }

  const allThreads = computed(() => flattenThreads(projectGroups.value))
  const selectedThread = computed(() =>
    allThreads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
  )
  const selectedThreadGoal = computed<UiThreadGoal | null>(() => (
    threadGoalByThreadId.value[selectedThreadId.value] ?? null
  ))
  const selectedThreadGoalObservedAtMs = computed(() => (
    threadGoalObservedAtByThreadId.value[selectedThreadId.value] ?? 0
  ))
  const selectedThreadGoalActiveTurnStartedAtMs = computed(() => {
    const turnId = activeTurnIdByThreadId.value[selectedThreadId.value]
    if (!turnId || inProgressById.value[selectedThreadId.value] !== true) return 0
    return pendingTurnStartsById.get(turnId)?.startedAtMs ?? 0
  })
  const isSelectedThreadGoalLoading = computed(() => (
    threadGoalLoadingByThreadId.value[selectedThreadId.value] === true
  ))
  const isSelectedThreadGoalUpdating = computed(() => (
    threadGoalUpdatingByThreadId.value[selectedThreadId.value] === true
  ))
  const selectedThreadGoalError = computed(() => (
    threadGoalErrorByThreadId.value[selectedThreadId.value] ?? ''
  ))
  const selectedThreadTerminalOpen = computed(() => {
    const threadId = selectedThreadId.value
    return Boolean(threadId && terminalOpenByThreadId.value[threadId] === true)
  })
  const isSelectedThreadInterruptPending = computed(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return false
    return interruptBlockedUntilPersistedByThreadId.value[threadId] === true
  })
  const selectedThreadServerRequests = computed<UiServerRequest[]>(() => {
    const rows: UiServerRequest[] = []
    const selected = selectedThreadId.value
    if (selected && Array.isArray(pendingServerRequestsByThreadId.value[selected])) {
      rows.push(...pendingServerRequestsByThreadId.value[selected])
    }
    if (Array.isArray(pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
    }
    return rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
  })
  const selectedThreadSubagents = computed<UiSubagent[]>(() => {
    const threadId = selectedThreadId.value
    return threadId ? subagentsByParentThreadId.value[threadId] ?? [] : []
  })
  function getLiveOverlayForThread(threadId: string): UiLiveOverlay | null {
    if (!threadId) return null

    const isInProgress = inProgressById.value[threadId] === true
    const activity = isInProgress ? turnActivityByThreadId.value[threadId] : undefined
    const reasoningText = isInProgress
      ? (liveReasoningTextByThreadId.value[threadId] ?? '').trim()
      : ''
    const liveErrorText = (turnErrorByThreadId.value[threadId]?.message ?? '').trim()
    let latestPersistedTurnErrorText = ''
    if (!isInProgress && liveErrorText) {
      const persistedMessages = persistedMessagesByThreadId.value[threadId] ?? []
      for (let index = persistedMessages.length - 1; index >= 0; index -= 1) {
        const message = persistedMessages[index]
        if (message.messageType !== 'turnError') continue
        latestPersistedTurnErrorText = normalizeMessageText(message.text)
        break
      }
    }
    const errorText =
      !isInProgress && liveErrorText && latestPersistedTurnErrorText === liveErrorText
        ? ''
        : liveErrorText

    if (!isInProgress && !activity && !reasoningText && !errorText) return null
    return {
      activityLabel: activity?.label || 'Thinking',
      activityDetails: activity?.details ?? [],
      reasoningText,
      errorText,
    }
  }

  function applyThreadGoalSnapshot(threadId: string, goal: UiThreadGoal | null): void {
    loadedThreadGoalIds.add(threadId)
    threadGoalRevisionByThreadId.set(threadId, (threadGoalRevisionByThreadId.get(threadId) ?? 0) + 1)
    threadGoalByThreadId.value = goal
      ? { ...threadGoalByThreadId.value, [threadId]: goal }
      : omitKey(threadGoalByThreadId.value, threadId)
    threadGoalObservedAtByThreadId.value = goal
      ? { ...threadGoalObservedAtByThreadId.value, [threadId]: Date.now() }
      : omitKey(threadGoalObservedAtByThreadId.value, threadId)
    threadGoalErrorByThreadId.value = omitKey(threadGoalErrorByThreadId.value, threadId)
  }

  function loadThreadGoal(threadId: string, options: { force?: boolean } = {}): Promise<void> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || normalizedThreadId === NEW_THREAD_COLLABORATION_MODE_CONTEXT) {
      return Promise.resolve()
    }
    const existing = threadGoalRequestByThreadId.get(normalizedThreadId)
    if (existing) {
      return options.force === true
        ? existing.then(() => loadThreadGoal(normalizedThreadId, { force: true }))
        : existing
    }
    if (loadedThreadGoalIds.has(normalizedThreadId) && options.force !== true) return Promise.resolve()

    const requestEpoch = threadGoalRequestEpoch
    const revision = threadGoalRevisionByThreadId.get(normalizedThreadId) ?? 0
    threadGoalLoadingByThreadId.value = {
      ...threadGoalLoadingByThreadId.value,
      [normalizedThreadId]: true,
    }
    const promise = getThreadGoal(normalizedThreadId)
      .then((goal) => {
        if (
          requestEpoch === threadGoalRequestEpoch
          && revision === (threadGoalRevisionByThreadId.get(normalizedThreadId) ?? 0)
          && threadGoalUpdatingByThreadId.value[normalizedThreadId] !== true
        ) {
          applyThreadGoalSnapshot(normalizedThreadId, goal)
        }
      })
      .catch((unknownError) => {
        if (
          requestEpoch !== threadGoalRequestEpoch
          || revision !== (threadGoalRevisionByThreadId.get(normalizedThreadId) ?? 0)
          || threadGoalUpdatingByThreadId.value[normalizedThreadId] === true
        ) return
        threadGoalErrorByThreadId.value = {
          ...threadGoalErrorByThreadId.value,
          [normalizedThreadId]: unknownError instanceof Error ? unknownError.message : 'Failed to load goal',
        }
      })
      .finally(() => {
        if (threadGoalRequestByThreadId.get(normalizedThreadId) !== promise) return
        threadGoalRequestByThreadId.delete(normalizedThreadId)
        threadGoalLoadingByThreadId.value = omitKey(threadGoalLoadingByThreadId.value, normalizedThreadId)
      })
    threadGoalRequestByThreadId.set(normalizedThreadId, promise)
    return promise
  }

  async function updateThreadGoal(
    threadId: string,
    input: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null },
  ): Promise<boolean> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || threadGoalUpdatingByThreadId.value[normalizedThreadId]) return false
    const requestEpoch = threadGoalRequestEpoch
    const revision = (threadGoalRevisionByThreadId.get(normalizedThreadId) ?? 0) + 1
    threadGoalRevisionByThreadId.set(normalizedThreadId, revision)
    threadGoalUpdatingByThreadId.value = {
      ...threadGoalUpdatingByThreadId.value,
      [normalizedThreadId]: true,
    }
    threadGoalErrorByThreadId.value = omitKey(threadGoalErrorByThreadId.value, normalizedThreadId)
    try {
      const goal = await setThreadGoal(normalizedThreadId, input)
      if (requestEpoch !== threadGoalRequestEpoch) return false
      if (revision === (threadGoalRevisionByThreadId.get(normalizedThreadId) ?? 0)) {
        applyThreadGoalSnapshot(normalizedThreadId, goal)
      }
      return true
    } catch (unknownError) {
      if (
        requestEpoch !== threadGoalRequestEpoch
        || revision !== (threadGoalRevisionByThreadId.get(normalizedThreadId) ?? 0)
      ) return false
      threadGoalErrorByThreadId.value = {
        ...threadGoalErrorByThreadId.value,
        [normalizedThreadId]: unknownError instanceof Error ? unknownError.message : 'Failed to update goal',
      }
      return false
    } finally {
      if (requestEpoch === threadGoalRequestEpoch) {
        threadGoalUpdatingByThreadId.value = omitKey(threadGoalUpdatingByThreadId.value, normalizedThreadId)
      }
    }
  }

  function saveSelectedThreadGoal(objective: string, tokenBudget: number | null): Promise<boolean> {
    const threadId = selectedThreadId.value
    const current = threadGoalByThreadId.value[threadId]
    const status = current && (current.status === 'budgetLimited' || current.status === 'complete')
      ? 'active'
      : current?.status ?? 'active'
    return updateThreadGoal(threadId, {
      objective,
      status,
      tokenBudget,
    })
  }

  function setSelectedThreadGoalStatus(status: 'active' | 'paused'): Promise<boolean> {
    return updateThreadGoal(selectedThreadId.value, { status })
  }

  function reloadSelectedThreadGoal(): Promise<void> {
    const threadId = selectedThreadId.value.trim()
    if (!threadId) return Promise.resolve()
    threadGoalErrorByThreadId.value = omitKey(threadGoalErrorByThreadId.value, threadId)
    return loadThreadGoal(threadId, { force: true })
  }

  async function clearSelectedThreadGoal(): Promise<boolean> {
    const threadId = selectedThreadId.value.trim()
    if (!threadId || threadGoalUpdatingByThreadId.value[threadId]) return false
    const requestEpoch = threadGoalRequestEpoch
    const revision = (threadGoalRevisionByThreadId.get(threadId) ?? 0) + 1
    threadGoalRevisionByThreadId.set(threadId, revision)
    threadGoalUpdatingByThreadId.value = { ...threadGoalUpdatingByThreadId.value, [threadId]: true }
    threadGoalErrorByThreadId.value = omitKey(threadGoalErrorByThreadId.value, threadId)
    try {
      await clearThreadGoal(threadId)
      if (requestEpoch !== threadGoalRequestEpoch) return false
      if (revision === (threadGoalRevisionByThreadId.get(threadId) ?? 0)) {
        applyThreadGoalSnapshot(threadId, null)
      }
      return true
    } catch (unknownError) {
      if (
        requestEpoch !== threadGoalRequestEpoch
        || revision !== (threadGoalRevisionByThreadId.get(threadId) ?? 0)
      ) return false
      threadGoalErrorByThreadId.value = {
        ...threadGoalErrorByThreadId.value,
        [threadId]: unknownError instanceof Error ? unknownError.message : 'Failed to clear goal',
      }
      return false
    } finally {
      if (requestEpoch === threadGoalRequestEpoch) {
        threadGoalUpdatingByThreadId.value = omitKey(threadGoalUpdatingByThreadId.value, threadId)
      }
    }
  }
  const selectedLiveOverlay = computed<UiLiveOverlay | null>(() => getLiveOverlayForThread(selectedThreadId.value))
  const codexQuota = computed<UiRateLimitSnapshot | null>(() => codexRateLimit.value)
  const selectedThreadTokenUsage = computed<UiThreadTokenUsage | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null
    return threadTokenUsageByThreadId.value[threadId] ?? null
  })
  const selectedTurnThroughput = computed(() => {
    turnTokenThroughputRevision.value
    const threadId = selectedThreadId.value
    if (!threadId) return null
    const turnId = activeTurnIdByThreadId.value[threadId]
    if (turnId) {
      const startedAtMs = pendingTurnStartsById.get(turnId)?.startedAtMs ?? 0
      const tracker = turnTokenThroughputByThreadId.get(threadId)
      return tracker?.turnId === turnId
        ? {
            outputTokens: tracker.outputTokens,
            inputTokens: tracker.inputTokens,
            reasoningOutputTokens: tracker.reasoningOutputTokens,
            prefillDurationMs: tracker.prefillDurationMs,
            decodeDurationMs: tracker.decodeDurationMs,
            decodeSegmentCount: tracker.decodeSegmentCount,
            startedAtMs,
            durationMs: null,
            durationText: '',
          }
        : null
    }
    const summary = turnSummaryByThreadId.value[threadId]
      ?? savedTurnSummariesByThreadId.value[threadId]?.at(-1)
    return summary ? {
      outputTokens: summary.outputTokens ?? null,
      inputTokens: summary.inputTokens ?? null,
      reasoningOutputTokens: summary.reasoningOutputTokens ?? null,
      prefillDurationMs: summary.prefillDurationMs ?? null,
      decodeDurationMs: summary.decodeDurationMs ?? 0,
      decodeSegmentCount: summary.decodeSegmentCount ?? 0,
      startedAtMs: 0,
      durationMs: summary.durationMs,
      durationText: formatTurnDuration(summary.durationMs),
    } : null
  })
  function getMessagesForThread(threadId: string): UiMessage[] {
    if (!threadId) return []

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const livePlan = livePlanMessagesByThreadId.value[threadId] ?? []
    const liveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
    const liveCommands = liveCommandsByThreadId.value[threadId] ?? []
    const liveFileChanges = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    const combined = [...persisted, ...livePlan, ...liveCommands, ...liveFileChanges, ...liveAgent]

    const saved = savedTurnSummariesByThreadId.value[threadId] ?? []
    const current = turnSummaryByThreadId.value[threadId]
    if (!saved.length && !current) return combined
    const summaries = current && !saved.some((summary) => summary.turnId === current.turnId)
      ? [...saved, current]
      : saved
    return insertTurnSummaryMessages(combined, summaries, current)
  }
  const messages = computed<UiMessage[]>(() => getMessagesForThread(selectedThreadId.value))
  const isSideConversationOpen = computed(() => sideConversationParentThreadId.value.length > 0)
  const sideConversationMessages = computed<UiMessage[]>(() => {
    const all = getMessagesForThread(sideConversationThreadId.value)
    const isSteering = (message: UiMessage) => message.messageType === 'userMessage.optimistic.steer' || message.messageType === 'userMessage.steer'
    const steering = all.filter(isSteering)
    return steering.length ? [...all.filter((message) => !isSteering(message)), ...steering] : all
  })
  const sideConversationLiveOverlay = computed<UiLiveOverlay | null>(() => (
    getLiveOverlayForThread(sideConversationThreadId.value)
  ))
  const isSideConversationInProgress = computed(() => (
    inProgressById.value[sideConversationThreadId.value] === true
  ))
  const sideConversationServerRequests = computed<UiServerRequest[]>(() => {
    const threadId = sideConversationThreadId.value
    return threadId ? pendingServerRequestsByThreadId.value[threadId] ?? [] : []
  })

  function isKnownSideConversationThread(threadId: string): boolean {
    return Boolean(threadId) && threadId === sideConversationThreadId.value
  }
  const hasMoreOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? hasMoreOlderMessagesByThreadId.value[threadId] === true : false
  })
  const isLoadingOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? loadingOlderMessagesByThreadId.value[threadId] === true : false
  })

  function getFirstPersistedTurnId(threadId: string): string {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    for (const message of persisted) {
      const turnId = message.turnId?.trim() ?? ''
      if (turnId) return turnId
    }
    return ''
  }

  function readModelIdForThread(threadId: string): string {
    const contextId = toThreadContextId(threadId)
    if (contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT) {
      const normalizedProviderId = normalizeProviderContextId(activeProviderId.value)
      const providerContextId = toProviderModelContextId(normalizedProviderId, activeAccountStorageId.value)
      const providerModelId = providerContextId
        ? normalizeStoredModelId(selectedModelIdByContext.value[providerContextId])
        : ''
      if (providerModelId) return providerModelId
    }
    return readSelectedModel(selectedModelIdByContext.value, threadId).trim()
  }

  function readProviderIdForThread(threadId: string): string {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return normalizeProviderContextId(activeProviderId.value)
    return normalizeProviderContextId(threadModelProviderByThreadId.value[normalizedThreadId] ?? activeProviderId.value)
  }

  function readRuntimeProviderIdForThread(threadId: string): string {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return activeRuntimeProviderId.value
    return threadModelProviderByThreadId.value[normalizedThreadId] ?? activeRuntimeProviderId.value
  }

  function readReasoningEffortForThread(threadId: string): ReasoningEffort | '' {
    return readSelectedReasoningEffort(
      selectedReasoningEffortByContext.value,
      threadId,
      readProviderIdForThread(threadId),
      activeAccountStorageId.value,
    )
  }

  function ensureAvailableModelIds(...modelIds: string[]): void {
    const nextModelIds = [...availableModelIds.value]
    for (const modelId of modelIds) {
      const normalizedModelId = modelId.trim()
      if (normalizedModelId && !nextModelIds.includes(normalizedModelId)) {
        nextModelIds.push(normalizedModelId)
      }
    }
    if (!areStringArraysEqual(availableModelIds.value, nextModelIds)) {
      availableModelIds.value = nextModelIds
    }
  }

  function ensureAvailableReasoningEffort(modelId: string, effort: ReasoningEffort | ''): void {
    const normalizedModelId = modelId.trim()
    if (!normalizedModelId || !effort) return
    const current = availableModelReasoningEfforts.value[normalizedModelId] ?? []
    if (current.includes(effort)) return
    availableModelReasoningEfforts.value = {
      ...availableModelReasoningEfforts.value,
      [normalizedModelId]: [...current, effort],
    }
  }

  function readProviderCompatibleSelectedModel(modelId: string): string {
    const normalizedModelId = modelId.trim()
    if (normalizedModelId) {
      ensureAvailableModelIds(normalizedModelId)
      return normalizedModelId
    }
    return availableModelIds.value[0] ?? ''
  }

  function setSelectedThreadId(nextThreadId: string, options: { persist?: boolean } = {}): void {
    if (selectedThreadId.value === nextThreadId) return
    if (
      sideConversationParentThreadId.value
      && sideConversationParentThreadId.value !== nextThreadId
    ) {
      discardSideConversationInBackground()
    }
    selectedThreadId.value = nextThreadId
    if (options.persist !== false) {
      saveSelectedThreadId(nextThreadId)
    }
    selectedModelId.value = readProviderCompatibleSelectedModel(readModelIdForThread(nextThreadId))
    selectedReasoningEffort.value = readReasoningEffortForThread(nextThreadId) || 'medium'
    ensureAvailableReasoningEffort(selectedModelId.value, selectedReasoningEffort.value)
    selectedCollaborationMode.value = readSelectedCollaborationMode(
      selectedCollaborationModeByContext.value,
      nextThreadId,
    )
    activeReasoningItemIdByThreadId.clear()
    shouldAutoScrollOnNextAgentEvent = false
    void loadThreadGoal(nextThreadId)
  }

  function setSelectedModelIdForThread(threadId: string, modelId: string): void {
    const normalizedModelId = modelId.trim()
    const contextId = toThreadContextId(threadId)
    const normalizedProviderId = normalizeProviderContextId(activeProviderId.value)
    const providerContextId =
      contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
        ? toProviderModelContextId(normalizedProviderId, activeAccountStorageId.value)
        : ''
    const selectedContextId = providerContextId || contextId
    if (normalizedModelId) {
      const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
      nextModelMap[selectedContextId] = normalizedModelId
      if (providerContextId) {
        delete nextModelMap[contextId]
      }
      selectedModelIdByContext.value = nextModelMap
    } else {
      let nextModelMap = omitStringKeyedRecordKey(selectedModelIdByContext.value, selectedContextId)
      if (providerContextId) {
        nextModelMap = omitStringKeyedRecordKey(nextModelMap, contextId)
      }
      selectedModelIdByContext.value = nextModelMap
    }
    if (threadId.trim() === selectedThreadId.value) {
      selectedModelId.value = readModelIdForThread(selectedThreadId.value)
      ensureAvailableModelIds(selectedModelId.value)
      ensureAvailableReasoningEffort(selectedModelId.value, selectedReasoningEffort.value)
    } else {
      ensureAvailableModelIds(normalizedModelId)
    }
    saveSelectedModelMap(selectedModelIdByContext.value)
  }

  function setSelectedModelId(modelId: string): void {
    setSelectedModelIdForThread(selectedThreadId.value, modelId)
  }

  function setThreadModelId(threadId: string, modelId: string, options: { force?: boolean } = {}): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    if (isKnownSideConversationThread(normalizedThreadId)) return

    const normalizedModelId = modelId.trim()
    const existingModelId = normalizeStoredModelId(selectedModelIdByContext.value[normalizedThreadId])
    if (existingModelId && !options.force) {
      ensureAvailableModelIds(existingModelId)
      if (selectedThreadId.value === normalizedThreadId) {
        selectedModelId.value = existingModelId
        ensureAvailableReasoningEffort(existingModelId, selectedReasoningEffort.value)
      }
      return
    }
    if (normalizedModelId) {
      const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
      nextModelMap[normalizedThreadId] = normalizedModelId
      selectedModelIdByContext.value = nextModelMap
    } else {
      selectedModelIdByContext.value = omitStringKeyedRecordKey(selectedModelIdByContext.value, normalizedThreadId)
    }
    ensureAvailableModelIds(normalizedModelId)
    if (selectedThreadId.value === normalizedThreadId) {
      selectedModelId.value = readModelIdForThread(selectedThreadId.value)
      ensureAvailableReasoningEffort(selectedModelId.value, selectedReasoningEffort.value)
    }
    saveSelectedModelMap(selectedModelIdByContext.value)
  }

  function setThreadModelProviderId(threadId: string, providerId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    const runtimeProviderId = providerId.trim()
    if (runtimeProviderId) {
      threadModelProviderByThreadId.value = {
        ...threadModelProviderByThreadId.value,
        [normalizedThreadId]: runtimeProviderId,
      }
    } else if (threadModelProviderByThreadId.value[normalizedThreadId]) {
      threadModelProviderByThreadId.value = omitKey(threadModelProviderByThreadId.value, normalizedThreadId)
    }
  }

  function resolveThreadModelForProvider(threadId: string, modelId: string, providerId: string): string {
    const normalizedModelId = modelId.trim()
    const normalizedProviderId = normalizeProviderContextId(providerId)
    if (normalizedProviderId !== 'opencode-zen') {
      return normalizedModelId
    }

    const previousThreadModel = readModelIdForThread(threadId).trim()
    if (previousThreadModel && !/^gpt-/i.test(previousThreadModel)) {
      return previousThreadModel
    }
    if (normalizedModelId && !/^gpt-/i.test(normalizedModelId)) {
      return normalizedModelId
    }
    return OPENCODE_ZEN_DEFAULT_MODEL
  }

  function setThreadTokenUsage(threadId: string, usage: UiThreadTokenUsage | null): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    if (!usage) {
      if (!(normalizedThreadId in threadTokenUsageByThreadId.value)) return
      threadTokenUsageByThreadId.value = omitKey(threadTokenUsageByThreadId.value, normalizedThreadId)
      saveThreadTokenUsageMap(threadTokenUsageByThreadId.value)
      return
    }

    const current = threadTokenUsageByThreadId.value[normalizedThreadId]
    if (current && JSON.stringify(current) === JSON.stringify(usage)) return

    threadTokenUsageByThreadId.value = {
      ...threadTokenUsageByThreadId.value,
      [normalizedThreadId]: usage,
    }
    saveThreadTokenUsageMap(threadTokenUsageByThreadId.value)
  }

  function applyTurnTokenUsage(update: ThreadTokenUsageUpdate): void {
    if (!update.turnId) return

    const summary = turnSummaryByThreadId.value[update.threadId]
    const activeTurnId = activeTurnIdByThreadId.value[update.threadId]
    let throughput = turnTokenThroughputByThreadId.get(update.threadId)
    const totalOutputTokens = update.usage.total.outputTokens
    if (throughput && throughput.turnId !== update.turnId) {
      if (
        throughput.priorTurnId === update.turnId &&
        throughput.phase !== 'invalid' &&
        throughput.outputTokens === null &&
        (throughput.baselineOutputTokens === null || totalOutputTokens >= throughput.baselineOutputTokens)
      ) {
        turnTokenThroughputByThreadId.set(update.threadId, {
          ...throughput,
          baselineOutputTokens: totalOutputTokens,
          phase: 'tracking',
        })
      }
      return
    }
    if (!throughput) {
      if (activeTurnId !== update.turnId && summary?.turnId !== update.turnId) return
      throughput = {
        turnId: update.turnId,
        priorTurnId: null,
        baselineOutputTokens: null,
        outputTokens: null,
        inputTokens: null,
        reasoningOutputTokens: null,
        prefillDurationMs: null,
        decodeMessageId: null,
        decodeLastDeltaAtMs: null,
        decodeDurationMs: 0,
        decodeSegmentCount: 0,
        phase: 'inferBaseline',
      }
    }
    if (throughput.phase === 'invalid') return

    const lastOutputTokens = update.usage.last.outputTokens
    let baselineOutputTokens = throughput.baselineOutputTokens
    if (baselineOutputTokens === null) {
      if (throughput.phase === 'observeBaseline') {
        baselineOutputTokens = totalOutputTokens
      } else {
        const inferredBaseline = totalOutputTokens - lastOutputTokens
        baselineOutputTokens = Number.isSafeInteger(inferredBaseline) && inferredBaseline >= 0
          ? inferredBaseline
          : null
      }
    }

    const previousTotalOutputTokens = baselineOutputTokens === null
      ? null
      : baselineOutputTokens + (throughput.outputTokens ?? 0)
    const outputTokens = baselineOutputTokens === null
      ? null
      : totalOutputTokens - baselineOutputTokens
    const invalid = (
      previousTotalOutputTokens !== null && totalOutputTokens < previousTotalOutputTokens
    ) || !(
      typeof outputTokens === 'number' &&
      Number.isSafeInteger(outputTokens) &&
      outputTokens >= 0
    )
    const validOutputTokens = invalid ? null : outputTokens

    turnTokenThroughputByThreadId.set(update.threadId, {
      ...throughput,
      baselineOutputTokens,
      outputTokens: validOutputTokens,
      inputTokens: update.usage.last.inputTokens,
      reasoningOutputTokens: update.usage.last.reasoningOutputTokens,
      phase: invalid ? 'invalid' : 'tracking',
    })
    turnTokenThroughputRevision.value += 1

    if (summary?.turnId === update.turnId) {
      setTurnSummaryForThread(update.threadId, {
        ...summary,
        outputTokens: validOutputTokens && validOutputTokens > 0 ? validOutputTokens : undefined,
        inputTokens: update.usage.last.inputTokens,
        reasoningOutputTokens: update.usage.last.reasoningOutputTokens,
      })
    }
  }

  function setSelectedCollaborationMode(mode: CollaborationModeKind): void {
    const nextMode: CollaborationModeKind = mode === 'plan' ? 'plan' : 'default'
    const contextId = toThreadContextId(selectedThreadId.value)
    const currentMode = readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value)
    if (currentMode === nextMode && selectedCollaborationMode.value === nextMode) return
    selectedCollaborationMode.value = nextMode
    selectedCollaborationModeByContext.value = writeSelectedCollaborationModeForContext(
      selectedCollaborationModeByContext.value,
      contextId,
      nextMode,
    )
    saveSelectedCollaborationModeMap(selectedCollaborationModeByContext.value)
  }

  function setSelectedCollaborationModeForThread(threadId: string, mode: CollaborationModeKind): void {
    const nextMode = mode === 'plan' ? 'plan' : 'default'
    selectedCollaborationModeByContext.value = writeSelectedCollaborationModeForContext(
      selectedCollaborationModeByContext.value,
      threadId,
      nextMode,
    )
    if (threadId.trim() === selectedThreadId.value) {
      selectedCollaborationMode.value = nextMode
    }
    saveSelectedCollaborationModeMap(selectedCollaborationModeByContext.value)
  }

  function setCodexRateLimit(nextSnapshot: UiRateLimitSnapshot | null): void {
    codexRateLimit.value = nextSnapshot
  }

  async function applyFallbackModelSelection(threadId: string = selectedThreadId.value): Promise<void> {
    if (threadId.trim()) {
      setThreadModelId(threadId, MODEL_FALLBACK_ID, { force: true })
    } else {
      setSelectedModelId(MODEL_FALLBACK_ID)
    }
    ensureAvailableModelIds(MODEL_FALLBACK_ID)
  }

  function setPendingTurnRequest(threadId: string, request: PendingTurnRequest): void {
    pendingTurnRequestByThreadId.value = {
      ...pendingTurnRequestByThreadId.value,
      [threadId]: request,
    }
  }

  function clearPendingTurnRequest(threadId: string): void {
    if (!pendingTurnRequestByThreadId.value[threadId]) return
    pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId)
  }



  async function retryPendingTurnWithFallback(threadId: string): Promise<void> {
    if (fallbackRetryInFlightThreadIds.has(threadId)) return
    const pending = pendingTurnRequestByThreadId.value[threadId]
    if (!pending || pending.fallbackRetried) return

    fallbackRetryInFlightThreadIds.add(threadId)
    setPendingTurnRequest(threadId, {
      ...pending,
      fallbackRetried: true,
    })

    try {
      await applyFallbackModelSelection(threadId)
      // Remove the failed user turn before replaying on fallback model to avoid duplicated user messages.
      try {
        const rolledBackMessages = await rollbackThread(threadId, 1)
        setPersistedMessagesForThread(threadId, rolledBackMessages)
        clearLivePlansForThread(threadId)
        setLiveAgentMessagesForThread(threadId, [])
        clearLiveReasoningForThread(threadId)
        if (liveCommandsByThreadId.value[threadId]) {
          liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
        }
      } catch {
        // If rollback fails, continue with retry rather than dropping the turn.
      }
      setTurnErrorForThread(threadId, null)
      error.value = ''
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, {
        label: 'Thinking',
        details: buildPendingTurnDetails(MODEL_FALLBACK_ID, pending.effort, pending.collaborationMode),
      })
      setThreadInProgress(threadId, true)

      if (resumedThreadById.value[threadId] !== true) {
        const resumedThread = await resumeThread(threadId)
        if (resumedThread.model) {
          setThreadModelId(threadId, resolveThreadModelForProvider(threadId, resumedThread.model, resumedThread.modelProvider))
        }
        if (resumedThread.modelProvider) {
          setThreadModelProviderId(threadId, resumedThread.modelProvider)
        }
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const fallbackTurnId = await startThreadTurn(
        threadId,
        pending.text,
        pending.imageUrls,
        MODEL_FALLBACK_ID,
        pending.effort || undefined,
        pending.skills.length > 0 ? pending.skills : undefined,
        pending.fileAttachments,
        pending.collaborationMode,
      )
      if (fallbackTurnId) {
        rememberObservedTurnStart(threadId, fallbackTurnId)
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: fallbackTurnId,
        }
        maybeUnblockInterruptForActiveTurn(threadId, fallbackTurnId)
      }

      scheduleRateLimitRefresh()
      pendingThreadMessageRefresh.add(threadId)
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
    } finally {
      fallbackRetryInFlightThreadIds.delete(threadId)
    }
  }

  function setSelectedReasoningEffortForThread(threadId: string, effort: ReasoningEffort | ''): void {
    if (effort && !REASONING_EFFORT_OPTIONS.includes(effort)) {
      return
    }

    const contextId = toThreadContextId(threadId)
    const providerContextId = contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
      ? toProviderModelContextId(readProviderIdForThread(threadId), activeAccountStorageId.value)
      : ''
    const selectedContextId = providerContextId || contextId
    if (effort) {
      selectedReasoningEffortByContext.value = {
        ...selectedReasoningEffortByContext.value,
        [selectedContextId]: effort,
      }
    } else {
      selectedReasoningEffortByContext.value = omitStringKeyedRecordKey(
        selectedReasoningEffortByContext.value,
        selectedContextId,
      )
    }
    if (threadId.trim() === selectedThreadId.value) {
      selectedReasoningEffort.value = effort
      ensureAvailableReasoningEffort(readModelIdForThread(threadId), effort)
    }
    saveSelectedReasoningEffortMap(selectedReasoningEffortByContext.value)
  }

  function setSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
    setSelectedReasoningEffortForThread(selectedThreadId.value, effort)
  }

  async function updateSelectedSpeedMode(mode: SpeedMode): Promise<void> {
    const nextMode: SpeedMode = mode === 'fast' ? 'fast' : 'standard'
    if (isUpdatingSpeedMode.value || selectedSpeedMode.value === nextMode) {
      return
    }

    const previousMode = selectedSpeedMode.value
    selectedSpeedMode.value = nextMode
    isUpdatingSpeedMode.value = true
    error.value = ''

    try {
      await setCodexSpeedMode(nextMode)
    } catch (unknownError) {
      selectedSpeedMode.value = previousMode
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to update Fast mode'
    } finally {
      isUpdatingSpeedMode.value = false
    }
  }

  async function refreshCollaborationModes(): Promise<void> {
    try {
      const modes = await getAvailableCollaborationModes()
      availableCollaborationModes.value = modes
      if (!modes.some((mode) => mode.value === selectedCollaborationMode.value)) {
        setSelectedCollaborationMode('default')
      }
    } catch {
      // Keep the last known collaboration mode choices on transient failures.
    }
  }

  function buildPendingTurnDetails(
    modelId: string,
    effort: ReasoningEffort | '',
    collaborationMode: CollaborationModeKind = selectedCollaborationMode.value,
  ): string[] {
    const modelLabel = modelId.trim() || 'default'
    const effortLabel = effort || 'default'
    const modeLabel = collaborationMode === 'plan' ? 'Plan' : 'Default'
    const speedLabel = selectedSpeedMode.value === 'fast' ? 'Fast' : 'Standard'
    return [`Mode: ${modeLabel}`, `Model: ${modelLabel}`, `Thinking: ${effortLabel}`, `Speed: ${speedLabel}`]
  }

  async function refreshModelPreferences(options?: { providerChanged?: boolean; includeProviderModels?: boolean }): Promise<void> {
    const requestEpoch = ++modelPreferencesRequestEpoch
    const accountId = activeAccountStorageId.value
    const targetThreadId = selectedThreadId.value
    const isCurrentRequest = () => (
      requestEpoch === modelPreferencesRequestEpoch
      && activeAccountStorageId.value === accountId
      && selectedThreadId.value === targetThreadId
    )
    codexCliMissingError.value = ''
    try {
      const currentConfig = await getCurrentModelConfig()
      if (!isCurrentRequest()) return
      const normalizedConfiguredModelId = currentConfig.model.trim()
      activeRuntimeProviderId.value = currentConfig.providerId.trim()
      const normalizedProviderId = normalizeProviderContextId(currentConfig.providerId)
      activeProviderId.value = normalizedProviderId
      const targetProviderId = readProviderIdForThread(targetThreadId)
      const usesUpstreamCatalog = targetProviderId === 'codex'
        || (currentConfig.upstreamCatalogProviderIds ?? [])
          .map(normalizeProviderContextId)
          .includes(targetProviderId)
      const isProviderBacked = !usesUpstreamCatalog
      const selectedThreadContextId = toThreadContextId(targetThreadId)
      let modelReasoningEfforts: Record<string, ReasoningEffort[]> | null = null
      const modelIds = await getAvailableModelIds({
        includeProviderModels: isProviderBacked && options?.includeProviderModels !== false,
        requireProviderModels: isProviderBacked,
        providerId: isProviderBacked ? targetProviderId : undefined,
        onModelCatalog: (models) => {
          modelReasoningEfforts = Object.fromEntries(
            models.map(({ id, supportedReasoningEfforts }) => [id, supportedReasoningEfforts]),
          )
        },
      })
      if (!isCurrentRequest()) return
      if (modelReasoningEfforts) {
        availableModelReasoningEfforts.value = modelReasoningEfforts
      }
      const providerModelContextId = toProviderModelContextId(targetProviderId, accountId)
      const providerScopedModelId = providerModelContextId
        ? normalizeStoredModelId(selectedModelIdByContext.value[providerModelContextId])
        : ''
      const threadScopedModelId = normalizeStoredModelId(
        selectedModelIdByContext.value[selectedThreadContextId],
      )
      const configuredModelId = targetProviderId === normalizedProviderId
        ? normalizedConfiguredModelId
        : ''
      const isNewThreadContext = selectedThreadContextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
      const selectedModel = threadScopedModelId
        || (isNewThreadContext ? providerScopedModelId : readModelIdForThread(targetThreadId))
        || configuredModelId
        || modelIds[0]
        || ''
      availableModelIds.value = selectedModel && !modelIds.includes(selectedModel)
        ? [...modelIds, selectedModel]
        : [...modelIds]
      if (selectedModel) {
        if (isNewThreadContext) {
          setSelectedModelIdForThread(targetThreadId, selectedModel)
        } else {
          selectedModelId.value = readProviderCompatibleSelectedModel(selectedModel)
          ensureAvailableReasoningEffort(selectedModelId.value, selectedReasoningEffort.value)
        }
      }

      const storedEffort = readSelectedReasoningEffort(
        selectedReasoningEffortByContext.value,
        targetThreadId,
        targetProviderId,
        accountId,
      )
      const configuredEffort = targetProviderId === normalizedProviderId
        ? normalizeStoredReasoningEffort(currentConfig.reasoningEffort)
        : ''
      const selectedEffort = storedEffort || configuredEffort || 'medium'
      if (!storedEffort) {
        setSelectedReasoningEffortForThread(targetThreadId, selectedEffort)
      } else {
        selectedReasoningEffort.value = selectedEffort
        ensureAvailableReasoningEffort(selectedModel, selectedEffort)
      }
      selectedSpeedMode.value = currentConfig.speedMode
    } catch (unknownError) {
      if (!isCurrentRequest()) return
      if (isCodexCliMissingError(unknownError)) {
        codexCliMissingError.value = CODEX_CLI_MISSING_MESSAGE
      } else {
        codexCliMissingError.value = ''
      }
      // Keep chat UI usable even if model metadata is temporarily unavailable.
    }
  }

  async function refreshRateLimits(): Promise<void> {
    if (rateLimitRefreshPromise) {
      await rateLimitRefreshPromise
      return
    }

    rateLimitRefreshPromise = (async () => {
      try {
        const snapshot = await getAccountRateLimits()
        setCodexRateLimit(snapshot)
        accountRateLimitSnapshots.value = snapshot ? [snapshot] : []
      } catch {
        // Keep the last known rate-limit state if the endpoint is temporarily unavailable.
      } finally {
        rateLimitRefreshPromise = null
      }
    })()

    await rateLimitRefreshPromise
  }

  function scheduleRateLimitRefresh(): void {
    if (typeof window === 'undefined') {
      void refreshRateLimits()
      return
    }

    if (rateLimitRefreshTimer !== null) {
      window.clearTimeout(rateLimitRefreshTimer)
    }

    rateLimitRefreshTimer = window.setTimeout(() => {
      rateLimitRefreshTimer = null
      void refreshRateLimits()
    }, RATE_LIMIT_REFRESH_DEBOUNCE_MS)
  }

  function clearDelayedTurnSync(threadId: string): void {
    if (!threadId || typeof window === 'undefined') return
    const timerId = delayedTurnSyncTimerByThreadId.get(threadId)
    if (timerId === undefined) return
    window.clearTimeout(timerId)
    delayedTurnSyncTimerByThreadId.delete(threadId)
  }

  function scheduleDelayedTurnSync(threadId: string): void {
    if (!threadId || typeof window === 'undefined') return
    clearDelayedTurnSync(threadId)
    const timerId = window.setTimeout(() => {
      delayedTurnSyncTimerByThreadId.delete(threadId)
      pendingThreadMessageRefresh.add(threadId)
      void syncFromNotifications()
    }, TURN_START_FOLLOW_UP_SYNC_DELAY_MS)
    delayedTurnSyncTimerByThreadId.set(threadId, timerId)
  }

  function applyCachedTitlesToGroups(groups: UiProjectGroup[]): UiProjectGroup[] {
    const titles = threadTitleById.value
    if (Object.keys(titles).length === 0) return groups
    return groups.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const cached = titles[thread.id]
        return cached ? { ...thread, title: cached } : thread
      }),
    }))
  }

  function getThreadPendingRequests(threadId: string): UiServerRequest[] {
    if (!threadId) return []
    return Array.isArray(pendingServerRequestsByThreadId.value[threadId])
      ? pendingServerRequestsByThreadId.value[threadId]
      : []
  }

  function isApprovalRequestMethod(method: string): boolean {
    return (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'item/permissions/requestApproval' ||
      method === 'execCommandApproval' ||
      method === 'applyPatchApproval'
    )
  }

  function readPendingRequestState(requests: UiServerRequest[]): UiPendingRequestState | null {
    if (requests.some((request) => isApprovalRequestMethod(request.method))) {
      return 'approval'
    }
    return requests.length > 0 ? 'response' : null
  }

  function applyThreadFlags(): void {
    const withTitles = applyCachedTitlesToGroups(sourceGroups.value)
    const flaggedGroups: UiProjectGroup[] = withTitles.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const inProgress = inProgressById.value[thread.id] === true
        const pendingRequestState = readPendingRequestState(getThreadPendingRequests(thread.id))
        const isSelected = selectedThreadId.value === thread.id
        const unreadByEvent = eventUnreadByThreadId.value[thread.id] === true
        const unreadByTime = isThreadUnreadByLastRead(
          thread.updatedAtIso,
          readStateByThreadId.value[thread.id],
          unreadCutoffIso.value,
        )
        const unread = !isSelected && !inProgress && (unreadByEvent || unreadByTime)

        return {
          ...thread,
          inProgress,
          unread,
          pendingRequestState,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string): void {
    const nowIso = new Date().toISOString()
    const normalizedCwd = normalizePathForUi(cwd)
    const projectName = toProjectName(normalizedCwd)
    const nextThread: UiThread = {
      id: threadId,
      title: toOptimisticThreadTitle(firstMessageText),
      projectName,
      cwd: normalizedCwd,
      hasWorktree: normalizedCwd.includes('/.codex/worktrees/') || normalizedCwd.includes('/.git/worktrees/'),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      preview: firstMessageText,
      unread: false,
      inProgress: false,
    }

    const existingGroupIndex = sourceGroups.value.findIndex((group) => group.projectName === projectName)
    if (existingGroupIndex >= 0) {
      const existingGroup = sourceGroups.value[existingGroupIndex]
      const remainingThreads = existingGroup.threads.filter((thread) => thread.id !== threadId)
      const nextGroup: UiProjectGroup = {
        projectName,
        threads: [nextThread, ...remainingThreads],
      }
      const nextGroups = [...sourceGroups.value]
      nextGroups.splice(existingGroupIndex, 1, nextGroup)
      sourceGroups.value = nextGroups
    } else {
      sourceGroups.value = [{ projectName, threads: [nextThread] }, ...sourceGroups.value]
    }

    const nextProjectOrder = mergeProjectOrder(projectOrder.value, sourceGroups.value)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }
    applyThreadFlags()
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    const currentThreadId = selectedThreadId.value.trim()
    if (currentThreadId) {
      activeThreadIds.add(currentThreadId)
    }
    if (sideConversationParentThreadId.value) activeThreadIds.add(sideConversationParentThreadId.value)
    if (sideConversationThreadId.value) activeThreadIds.add(sideConversationThreadId.value)
    const nextSelectedCollaborationModeMap = pruneThreadContextStateMap(
      selectedCollaborationModeByContext.value,
      activeThreadIds,
    )
    if (nextSelectedCollaborationModeMap !== selectedCollaborationModeByContext.value) {
      selectedCollaborationModeByContext.value = nextSelectedCollaborationModeMap
      selectedCollaborationMode.value = readSelectedCollaborationMode(
        nextSelectedCollaborationModeMap,
        selectedThreadId.value,
      )
      saveSelectedCollaborationModeMap(nextSelectedCollaborationModeMap)
    }
    const nextReadState = pruneThreadStateMap(readStateByThreadId.value, activeThreadIds)
    if (nextReadState !== readStateByThreadId.value) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    turnIndexByTurnIdByThreadId.value = pruneThreadStateMap(turnIndexByTurnIdByThreadId.value, activeThreadIds)
    persistedMessagesByThreadId.value = pruneThreadStateMap(persistedMessagesByThreadId.value, activeThreadIds)
    liveAgentMessagesByThreadId.value = pruneThreadStateMap(liveAgentMessagesByThreadId.value, activeThreadIds)
    liveReasoningTextByThreadId.value = pruneThreadStateMap(liveReasoningTextByThreadId.value, activeThreadIds)
    liveCommandsByThreadId.value = pruneThreadStateMap(liveCommandsByThreadId.value, activeThreadIds)
    liveFileChangeMessagesByThreadId.value = pruneThreadStateMap(liveFileChangeMessagesByThreadId.value, activeThreadIds)
    subagentsByParentThreadId.value = pruneThreadStateMap(subagentsByParentThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    if (hasLoadedAllThreadPages) {
      const saved = pruneThreadStateMap(savedTurnSummariesByThreadId.value, activeThreadIds)
      if (saved !== savedTurnSummariesByThreadId.value) {
        savedTurnSummariesByThreadId.value = saved
        saveTurnSummaries(saved)
      }
    }
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    activeTurnIdByThreadId.value = pruneThreadStateMap(activeTurnIdByThreadId.value, activeThreadIds)
    interruptBlockedUntilPersistedByThreadId.value = pruneThreadStateMap(
      interruptBlockedUntilPersistedByThreadId.value,
      activeThreadIds,
    )
    threadListedByServerById.value = pruneThreadStateMap(threadListedByServerById.value, activeThreadIds)
    persistedUserMessageByThreadId.value = pruneThreadStateMap(persistedUserMessageByThreadId.value, activeThreadIds)
    threadModelProviderByThreadId.value = pruneThreadStateMap(threadModelProviderByThreadId.value, activeThreadIds)
    threadGoalByThreadId.value = pruneThreadStateMap(threadGoalByThreadId.value, activeThreadIds)
    threadGoalObservedAtByThreadId.value = pruneThreadStateMap(threadGoalObservedAtByThreadId.value, activeThreadIds)
    threadGoalLoadingByThreadId.value = pruneThreadStateMap(threadGoalLoadingByThreadId.value, activeThreadIds)
    threadGoalUpdatingByThreadId.value = pruneThreadStateMap(threadGoalUpdatingByThreadId.value, activeThreadIds)
    threadGoalErrorByThreadId.value = pruneThreadStateMap(threadGoalErrorByThreadId.value, activeThreadIds)
    for (const threadId of loadedThreadGoalIds) {
      if (!activeThreadIds.has(threadId)) loadedThreadGoalIds.delete(threadId)
    }
    for (const threadId of threadGoalRevisionByThreadId.keys()) {
      if (!activeThreadIds.has(threadId) && !threadGoalRequestByThreadId.has(threadId)) {
        threadGoalRevisionByThreadId.delete(threadId)
      }
    }
    const nextQueuedMessages = pruneThreadStateMap(queuedMessagesByThreadId.value, activeThreadIds)
    if (nextQueuedMessages !== queuedMessagesByThreadId.value) {
      queuedMessagesByThreadId.value = nextQueuedMessages
      persistQueueState()
    }
    threadTokenUsageByThreadId.value = pruneThreadStateMap(threadTokenUsageByThreadId.value, activeThreadIds)
    eventUnreadByThreadId.value = pruneThreadStateMap(eventUnreadByThreadId.value, activeThreadIds)
    inProgressById.value = pruneThreadStateMap(inProgressById.value, activeThreadIds)
    const nextPending: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  function markThreadAsRead(threadId: string): void {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    if (!thread) return

    readStateByThreadId.value = {
      ...readStateByThreadId.value,
      [threadId]: thread.updatedAtIso,
    }
    saveReadStateMap(readStateByThreadId.value)
    if (eventUnreadByThreadId.value[threadId]) {
      eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, threadId)
    }
    applyThreadFlags()
  }

  function suppressUnreadForNonSuccessCompletion(threadId: string): void {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    const currentUpdatedAtIso = thread?.updatedAtIso ?? ''
    if (currentUpdatedAtIso) {
      readStateByThreadId.value = {
        ...readStateByThreadId.value,
        [threadId]: currentUpdatedAtIso,
      }
      saveReadStateMap(readStateByThreadId.value)
    }
    nonSuccessCompletionReadBaselineByThreadId.set(threadId, currentUpdatedAtIso)
  }

  function syncNonSuccessCompletionReadWatermarks(
    incomingGroups: UiProjectGroup[],
    activeThreadIds: Set<string>,
  ): void {
    if (nonSuccessCompletionReadBaselineByThreadId.size === 0) return

    let nextReadState = readStateByThreadId.value
    let readStateChanged = false
    for (const thread of flattenThreads(incomingGroups)) {
      const baseline = nonSuccessCompletionReadBaselineByThreadId.get(thread.id)
      if (baseline === undefined) continue
      const summaryAdvanced = baseline
        ? isThreadUpdatedAfterCutoff(thread.updatedAtIso, baseline)
        : Boolean(thread.updatedAtIso)
      if (!summaryAdvanced) continue
      if (nextReadState[thread.id] !== thread.updatedAtIso) {
        nextReadState = {
          ...nextReadState,
          [thread.id]: thread.updatedAtIso,
        }
        readStateChanged = true
      }
      nonSuccessCompletionReadBaselineByThreadId.delete(thread.id)
    }

    for (const threadId of nonSuccessCompletionReadBaselineByThreadId.keys()) {
      if (!activeThreadIds.has(threadId)) {
        nonSuccessCompletionReadBaselineByThreadId.delete(threadId)
      }
    }
    for (const threadId of turnTokenThroughputByThreadId.keys()) {
      if (!activeThreadIds.has(threadId)) {
        turnTokenThroughputByThreadId.delete(threadId)
      }
    }
    if (readStateChanged) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
  }

  function setTurnSummaryForThread(threadId: string, summary: TurnSummaryState | null, persist = false): void {
    if (!threadId) return

    const previous = turnSummaryByThreadId.value[threadId]
    if (summary) {
      if (areTurnSummariesEqual(previous, summary)) return
      turnSummaryByThreadId.value = {
        ...turnSummaryByThreadId.value,
        [threadId]: summary,
      }
      const saved = savedTurnSummariesByThreadId.value[threadId] ?? []
      const index = saved.findIndex((entry) => entry.turnId === summary.turnId)
      if (!isKnownSideConversationThread(threadId) && (persist || index >= 0)) {
        const next = [...saved]
        if (index >= 0) next[index] = summary
        else next.push(summary)
        savedTurnSummariesByThreadId.value = {
          ...savedTurnSummariesByThreadId.value,
          [threadId]: next.slice(-MAX_SAVED_TURN_SUMMARIES_PER_THREAD),
        }
        saveTurnSummaries(savedTurnSummariesByThreadId.value)
      }
    } else {
      if (previous) {
        turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
      }
    }
  }

  function setThreadInProgress(threadId: string, nextInProgress: boolean): void {
    if (!threadId) return
    const currentValue = inProgressById.value[threadId] === true
    if (currentValue === nextInProgress) return
    if (nextInProgress) {
      inProgressById.value = {
        ...inProgressById.value,
        [threadId]: true,
      }
    } else {
      if (isKnownSideConversationThread(threadId)) {
        const messages = [
          ...(persistedMessagesByThreadId.value[threadId] ?? []),
          ...(livePlanMessagesByThreadId.value[threadId] ?? []),
          ...(liveCommandsByThreadId.value[threadId] ?? []),
          ...(liveFileChangeMessagesByThreadId.value[threadId] ?? []),
          ...(liveAgentMessagesByThreadId.value[threadId] ?? []),
        ]
        clearLiveAgentMessagesForThread(threadId)
        clearLiveFileChangesForThread(threadId)
        setPersistedMessagesForThread(threadId, messages.map((message) => {
          if (message.messageType === 'userMessage.optimistic.steer') return { ...message, messageType: 'userMessage.optimistic' }
          if (message.messageType === 'userMessage.steer') return { ...message, messageType: 'userMessage' }
          return message
        }))
      }
      inProgressById.value = omitKey(inProgressById.value, threadId)
      clearCompletedTurnLiveState(threadId)
      clearInterruptPersistenceGate(threadId)
    }
    applyThreadFlags()
    if (!nextInProgress && !hasActiveInProgressThreads() && threadListNextCursor) {
      scheduleRemainingThreadPages()
    }
  }

  function clearInterruptPersistenceGate(threadId: string): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId]) {
      interruptBlockedUntilPersistedByThreadId.value = omitKey(interruptBlockedUntilPersistedByThreadId.value, threadId)
    }
    if (threadListedByServerById.value[threadId]) {
      threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    }
    if (persistedUserMessageByThreadId.value[threadId]) {
      persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    }
  }

  function blockInterruptUntilThreadIsPersisted(threadId: string): void {
    if (!threadId) return
    interruptBlockedUntilPersistedByThreadId.value = {
      ...interruptBlockedUntilPersistedByThreadId.value,
      [threadId]: true,
    }
    if (threadListedByServerById.value[threadId]) {
      threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    }
    if (persistedUserMessageByThreadId.value[threadId]) {
      persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    }
  }

  function maybeUnblockInterruptForPersistedThread(threadId: string): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    if (threadListedByServerById.value[threadId] !== true) return
    if (persistedUserMessageByThreadId.value[threadId] !== true) return
    clearInterruptPersistenceGate(threadId)
  }

  function maybeUnblockInterruptForActiveTurn(threadId: string, turnId: string): void {
    if (!threadId || !turnId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    clearInterruptPersistenceGate(threadId)
  }

  function markServerListedThreads(serverThreadIds: Set<string>): void {
    const pendingThreadIds = Object.keys(interruptBlockedUntilPersistedByThreadId.value)
    if (pendingThreadIds.length === 0) return

    let nextListedState = threadListedByServerById.value
    let changed = false
    for (const threadId of pendingThreadIds) {
      if (!serverThreadIds.has(threadId) || nextListedState[threadId] === true) continue
      nextListedState = {
        ...nextListedState,
        [threadId]: true,
      }
      changed = true
    }

    if (!changed) return
    threadListedByServerById.value = nextListedState
    for (const threadId of pendingThreadIds) {
      maybeUnblockInterruptForPersistedThread(threadId)
    }
  }

  function markThreadMessagesPersisted(threadId: string, messages: UiMessage[]): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    if (!messages.some((message) => message.role === 'user')) return
    if (persistedUserMessageByThreadId.value[threadId] !== true) {
      persistedUserMessageByThreadId.value = {
        ...persistedUserMessageByThreadId.value,
        [threadId]: true,
      }
    }
    maybeUnblockInterruptForPersistedThread(threadId)
  }

  function markThreadUnreadByEvent(threadId: string): void {
    if (!threadId) return
    if (threadId === selectedThreadId.value) return
    if (eventUnreadByThreadId.value[threadId] === true) return
    eventUnreadByThreadId.value = {
      ...eventUnreadByThreadId.value,
      [threadId]: true,
    }
    applyThreadFlags()
  }

  function setTurnActivityForThread(threadId: string, activity: TurnActivityState | null): void {
    if (!threadId) return

    const previous = turnActivityByThreadId.value[threadId]
    if (!activity) {
      if (previous) {
        turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      }
      return
    }

    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const mergedDetails = Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3)
    const nextActivity: TurnActivityState = {
      label: normalizedLabel,
      details: mergedDetails,
    }

    if (areTurnActivitiesEqual(previous, nextActivity)) return
    turnActivityByThreadId.value = {
      ...turnActivityByThreadId.value,
      [threadId]: nextActivity,
    }
  }

  function setTurnErrorForThread(
    threadId: string,
    message: string | null,
    options: { transient?: boolean } = {},
  ): void {
    if (!threadId) return

    const previous = turnErrorByThreadId.value[threadId]
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (!normalizedMessage) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    const transient = options.transient === true
    if (previous?.message === normalizedMessage && previous.transient === transient) return

    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage, transient },
    }
  }

  function clearTransientTurnErrorForThread(threadId: string): void {
    if (!threadId) return
    if (!turnErrorByThreadId.value[threadId]?.transient) return
    setTurnErrorForThread(threadId, null)
  }

  function clearAllTransientTurnErrors(): void {
    const transientThreadIds = Object.entries(turnErrorByThreadId.value)
      .filter(([, state]) => state?.transient)
      .map(([threadId]) => threadId)
    if (transientThreadIds.length === 0) return

    let nextState = turnErrorByThreadId.value
    for (const threadId of transientThreadIds) {
      nextState = omitKey(nextState, threadId)
    }
    turnErrorByThreadId.value = nextState
  }

  function currentThreadVersion(threadId: string): string {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    return thread?.updatedAtIso ?? ''
  }

  function setThreadTerminalOpen(threadId: string, isOpen: boolean): void {
    if (!threadId) return
    const next = { ...terminalOpenByThreadId.value }
    if (isOpen) {
      next[threadId] = true
    } else {
      delete next[threadId]
    }
    terminalOpenByThreadId.value = next
    saveThreadTerminalOpenMap(next)
  }

  function toggleSelectedThreadTerminal(): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    setThreadTerminalOpen(threadId, !selectedThreadTerminalOpen.value)
  }

  function setPersistedMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = persistedMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    persistedMessagesByThreadId.value = {
      ...persistedMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function appendOptimisticUserMessage(
    threadId: string,
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    isSteer = false,
  ): void {
    const existing = persistedMessagesByThreadId.value[threadId] ?? []
    const nextMessage: UiMessage = {
      id: `optimistic-user:${threadId}:${Date.now()}`,
      role: 'user',
      text,
      images: imageUrls.length > 0 ? [...imageUrls] : undefined,
      skills: skills.length > 0 ? skills.map((skill) => ({ name: skill.name, path: skill.path })) : undefined,
      fileAttachments: fileAttachments.length > 0 ? fileAttachments.map((file) => ({ ...file })) : undefined,
      createdAtIso: new Date().toISOString(),
      messageType: isSteer ? 'userMessage.optimistic.steer' : 'userMessage.optimistic',
      turnId: isSteer ? activeTurnIdByThreadId.value[threadId] : undefined,
    }
    setPersistedMessagesForThread(threadId, [...existing, nextMessage])
  }

  function setLiveAgentMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveAgentMessagesByThreadId.value = {
      ...liveAgentMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function clearLiveAgentMessagesForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveAgentMessagesByThreadId.value)) return
    liveAgentMessagesByThreadId.value = omitKey(liveAgentMessagesByThreadId.value, threadId)
  }

  function setLiveFileChangeMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveFileChangeMessagesByThreadId.value = {
      ...liveFileChangeMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function setLivePlanMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = livePlanMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    livePlanMessagesByThreadId.value = {
      ...livePlanMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function upsertLivePlanMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = livePlanMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLivePlanMessagesForThread(threadId, next)
  }

  function upsertLiveAgentMessage(threadId: string, nextMessage: UiMessage, turnId: string): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, { ...nextMessage, turnId: turnId || nextMessage.turnId })
    setLiveAgentMessagesForThread(threadId, next)
  }

  function upsertLiveFileChangeMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLiveFileChangeMessagesForThread(threadId, next)
  }

  function setLiveReasoningText(threadId: string, text: string): void {
    if (!threadId) return
    const normalized = text.trim()
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    if (normalized.length === 0) {
      if (!previous) return
      liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
      return
    }
    if (previous === normalized) return
    liveReasoningTextByThreadId.value = {
      ...liveReasoningTextByThreadId.value,
      [threadId]: normalized,
    }
  }

  function appendLiveReasoningText(threadId: string, delta: string): void {
    if (!threadId) return
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    setLiveReasoningText(threadId, `${previous}${delta}`)
  }

  function clearLiveReasoningForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveReasoningTextByThreadId.value)) return
    liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
  }

  function clearLivePlansForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in livePlanMessagesByThreadId.value)) return
    livePlanMessagesByThreadId.value = omitKey(livePlanMessagesByThreadId.value, threadId)
  }

  function clearLiveFileChangesForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveFileChangeMessagesByThreadId.value)) return
    liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
  }

  function clearCompletedTurnLiveState(threadId: string): void {
    if (!threadId) return
    clearLivePlansForThread(threadId)
    clearLiveReasoningForThread(threadId)
    setTurnActivityForThread(threadId, null)
    activeReasoningItemIdByThreadId.delete(threadId)
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
    if (activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }
    clearPendingTurnRequest(threadId)
  }

  function normalizePlanStepStatus(value: unknown): UiPlanStep['status'] {
    if (value === 'completed') return 'completed'
    if (value === 'inProgress' || value === 'in_progress') return 'inProgress'
    return 'pending'
  }

  function buildPlanMessageText(plan: UiPlanData): string {
    const lines: string[] = []
    if (plan.explanation?.trim()) {
      lines.push(plan.explanation.trim())
    }
    for (const step of plan.steps) {
      const marker = step.status === 'completed' ? 'x' : step.status === 'inProgress' ? '~' : ' '
      lines.push(`- [${marker}] ${step.step}`)
    }
    return lines.join('\n').trim()
  }

  function readPlanUpdate(notification: RpcNotification): { threadId: string; message: UiMessage } | null {
    if (notification.method !== 'turn/plan/updated') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const rawSteps = Array.isArray(params?.plan) ? params?.plan : []
    const steps: UiPlanStep[] = rawSteps
      .map((row) => asRecord(row))
      .map((row) => ({
        step: readString(row?.step),
        status: normalizePlanStepStatus(row?.status),
      }))
      .filter((row) => row.step.length > 0)

    if (!threadId || !turnId) return null

    const explanation = readString(params?.explanation).trim()
    const plan: UiPlanData = {
      explanation: explanation || undefined,
      steps,
      isStreaming: true,
    }

    return {
      threadId,
      message: {
        id: `${turnId}:plan`,
        role: 'assistant',
        text: buildPlanMessageText(plan),
        messageType: 'plan.live',
        plan,
      },
    }
  }

  function readPlanDelta(notification: RpcNotification): { threadId: string; message: UiMessage } | null {
    if (notification.method !== 'item/plan/delta') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const delta = readString(params?.delta)
    if (!threadId || !turnId || !delta) return null

    const messageId = `${turnId}:plan`
    const existing = (livePlanMessagesByThreadId.value[threadId] ?? []).find((message) => message.id === messageId)
    const nextText = `${existing?.text ?? ''}${delta}`
    const nextPlan: UiPlanData | undefined = existing?.plan
      ? { ...existing.plan, isStreaming: true }
      : undefined

    return {
      threadId,
      message: {
        id: messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'plan.live',
        plan: nextPlan,
      },
    }
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  function readString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  function getRateLimitSnapshotKey(snapshot: UiRateLimitSnapshot): string {
    return snapshot.limitId?.trim() || snapshot.limitName?.trim() || '__default__'
  }

  function normalizeRateLimitWindow(value: unknown): UiRateLimitSnapshot['primary'] {
    const record = asRecord(value)
    if (!record) return null

    const windowValue = readNumber(record.windowDurationMins)
    return {
      usedPercent: clamp(readNumber(record.usedPercent) ?? 0, 0, 100),
      windowDurationMins: windowValue,
      windowMinutes: windowValue,
      resetsAt: readNumber(record.resetsAt),
    }
  }

  function normalizeRateLimitSnapshot(value: unknown): UiRateLimitSnapshot | null {
    const record = asRecord(value)
    if (!record) return null

    const credits = asRecord(record.credits)
    return {
      limitId: readString(record.limitId) || null,
      limitName: readString(record.limitName) || null,
      primary: normalizeRateLimitWindow(record.primary),
      secondary: normalizeRateLimitWindow(record.secondary),
      credits: credits
        ? {
            hasCredits: credits.hasCredits === true,
            unlimited: credits.unlimited === true,
            balance: readString(credits.balance) || null,
          }
        : null,
      planType: readString(record.planType) || null,
    }
  }

  function normalizeRateLimitSnapshotsPayload(value: unknown): UiRateLimitSnapshot[] {
    const record = asRecord(value)
    if (!record) return []

    const next: UiRateLimitSnapshot[] = []
    const seen = new Set<string>()
    const pushSnapshot = (snapshot: UiRateLimitSnapshot | null): void => {
      if (!snapshot) return
      const key = getRateLimitSnapshotKey(snapshot)
      if (seen.has(key)) return
      seen.add(key)
      next.push(snapshot)
    }

    pushSnapshot(normalizeRateLimitSnapshot(record.rateLimits))

    const byLimitId = asRecord(record.rateLimitsByLimitId)
    if (byLimitId) {
      for (const snapshot of Object.values(byLimitId)) {
        pushSnapshot(normalizeRateLimitSnapshot(snapshot))
      }
    }

    return next
  }

  function normalizeTokenUsageBreakdown(value: unknown): UiTokenUsageBreakdown | null {
    const record = asRecord(value)
    if (!record) return null

    const totalTokens = readNumber(record.totalTokens ?? record.total_tokens)
    const inputTokens = readNumber(record.inputTokens ?? record.input_tokens)
    const cachedInputTokens = readNumber(record.cachedInputTokens ?? record.cached_input_tokens)
    const outputTokens = readNumber(record.outputTokens ?? record.output_tokens)
    const reasoningOutputTokens = readNumber(record.reasoningOutputTokens ?? record.reasoning_output_tokens)
    if (
      totalTokens === null ||
      inputTokens === null ||
      cachedInputTokens === null ||
      outputTokens === null ||
      reasoningOutputTokens === null
    ) {
      return null
    }

    return {
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
    }
  }

  function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
    const record = asRecord(value)
    if (!record) return null

    const total = normalizeTokenUsageBreakdown(record.total)
    const last = normalizeTokenUsageBreakdown(record.last)
    if (!total || !last) return null

    const modelContextWindow = readNumber(record.modelContextWindow ?? record.model_context_window)
    const currentContextTokens = last.totalTokens
    const remainingContextTokens = typeof modelContextWindow === 'number'
      ? Math.max(modelContextWindow - currentContextTokens, 0)
      : null
    const remainingContextPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
      ? clamp(Math.round((remainingContextTokens ?? 0) / modelContextWindow * 100), 0, 100)
      : null

    return {
      total,
      last,
      modelContextWindow,
      currentContextTokens,
      remainingContextTokens,
      remainingContextPercent,
    }
  }

  function readThreadTokenUsageUpdate(notification: RpcNotification): ThreadTokenUsageUpdate | null {
    if (notification.method !== 'thread/tokenUsage/updated') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const usage = normalizeThreadTokenUsage(params?.tokenUsage ?? params?.token_usage)
    if (!threadId || !usage) return null
    return { threadId, turnId, usage }
  }

  function extractThreadIdFromNotification(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    const directThreadId = readString(params.threadId)
    if (directThreadId) return directThreadId
    const snakeThreadId = readString(params.thread_id)
    if (snakeThreadId) return snakeThreadId

    const conversationId = readString(params.conversationId)
    if (conversationId) return conversationId
    const snakeConversationId = readString(params.conversation_id)
    if (snakeConversationId) return snakeConversationId

    const requestParams = asRecord(params.params)
    const requestThreadId = readString(requestParams?.threadId)
    if (requestThreadId) return requestThreadId
    const requestSnakeThreadId = readString(requestParams?.thread_id)
    if (requestSnakeThreadId) return requestSnakeThreadId
    const requestConversationId = readString(requestParams?.conversationId)
    if (requestConversationId) return requestConversationId
    const requestSnakeConversationId = readString(requestParams?.conversation_id)
    if (requestSnakeConversationId) return requestSnakeConversationId

    const thread = asRecord(params.thread)
    const nestedThreadId = readString(thread?.id)
    if (nestedThreadId) return nestedThreadId

    const turn = asRecord(params.turn)
    const turnThreadId = readString(turn?.threadId)
    if (turnThreadId) return turnThreadId
    const turnSnakeThreadId = readString(turn?.thread_id)
    if (turnSnakeThreadId) return turnSnakeThreadId

    return ''
  }

  function readTurnErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'turn/completed') return ''
    const params = asRecord(notification.params)
    const turn = asRecord(params?.turn)
    if (!turn || turn.status !== 'failed') return ''
    const errorPayload = asRecord(turn.error)
    return readString(errorPayload?.message)
  }

  function readNotificationErrorState(notification: RpcNotification): { message: string; transient: boolean } | null {
    if (notification.method !== 'error') return null
    const params = asRecord(notification.params)
    const message = (
      readString(params?.message) ||
      readString(asRecord(params?.error)?.message)
    )
    if (!message) return null

    return {
      message,
      transient: params?.willRetry === true,
    }
  }

  function normalizeServerRequest(params: unknown): UiServerRequest | null {
    const row = asRecord(params)
    if (!row) return null

    const id = row.id
    const rawMethod = readString(row.method)
    const requestParams = row.params
    if (typeof id !== 'number' || !Number.isInteger(id) || !rawMethod) {
      return null
    }

    const requestParamRecord = asRecord(requestParams)
    const method = normalizePendingServerRequestMethod(rawMethod, requestParamRecord)
    const threadId = (
      readString(requestParamRecord?.threadId) ||
      readString(requestParamRecord?.thread_id) ||
      readString(requestParamRecord?.conversationId) ||
      readString(requestParamRecord?.conversation_id) ||
      GLOBAL_SERVER_REQUEST_SCOPE
    )
    const turnId = readString(requestParamRecord?.turnId) || readString(requestParamRecord?.turn_id)
    const itemId = (
      readString(requestParamRecord?.itemId) ||
      readString(requestParamRecord?.item_id) ||
      readString(requestParamRecord?.callId) ||
      readString(requestParamRecord?.call_id)
    )
    const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString()

    return {
      id,
      method,
      threadId,
      turnId,
      itemId,
      receivedAtIso,
      params: requestParams ?? null,
    }
  }

  function normalizePendingServerRequestMethod(
    method: string,
    params: Record<string, unknown> | null,
  ): string {
    const normalized = method.trim()
    if (!normalized) return normalized

    if (
      normalized === 'item/commandExecution/requestApproval' ||
      normalized === 'execCommandApproval' ||
      normalized === 'exec_approval_request' ||
      looksLikeExecApprovalRequest(params)
    ) {
      return 'item/commandExecution/requestApproval'
    }

    if (
      normalized === 'item/fileChange/requestApproval' ||
      normalized === 'applyPatchApproval' ||
      normalized === 'apply_patch_approval_request' ||
      looksLikePatchApprovalRequest(params)
    ) {
      return 'item/fileChange/requestApproval'
    }

    if (
      normalized === 'item/tool/requestUserInput' ||
      normalized === 'request_user_input' ||
      looksLikeToolUserInputRequest(params)
    ) {
      return 'item/tool/requestUserInput'
    }

    if (
      normalized === 'mcpServer/elicitation/request' ||
      normalized === 'elicitation_request' ||
      looksLikeMcpServerElicitationRequest(params)
    ) {
      return 'mcpServer/elicitation/request'
    }

    if (normalized === 'item/permissions/requestApproval' || looksLikePermissionsApprovalRequest(params)) {
      return 'item/permissions/requestApproval'
    }

    if (
      normalized === 'item/tool/call' ||
      normalized === 'dynamic_tool_call_request' ||
      looksLikeToolCallRequest(params)
    ) {
      return 'item/tool/call'
    }

    return normalized
  }

  function looksLikeExecApprovalRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    const command = params.command
    if (Array.isArray(command) && command.some((part) => typeof part === 'string' && part.trim().length > 0)) {
      return true
    }
    if (typeof command === 'string' && command.trim().length > 0) {
      return true
    }
    return Array.isArray(params.commandActions)
  }

  function looksLikePatchApprovalRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    if (typeof params.grantRoot === 'string' && params.grantRoot.trim().length > 0) return true
    if (typeof params.grant_root === 'string' && params.grant_root.trim().length > 0) return true
    if (asRecord(params.fileChanges)) return true
    return asRecord(params.changes) !== null
  }

  function looksLikeToolUserInputRequest(params: Record<string, unknown> | null): boolean {
    return Boolean(params && Array.isArray(params.questions))
  }

  function looksLikeToolCallRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    return (
      typeof params.toolName === 'string' ||
      typeof params.tool_name === 'string' ||
      typeof params.name === 'string' ||
      Array.isArray(params.arguments)
    )
  }

  function looksLikeMcpServerElicitationRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    const mode = readString(params.mode)
    return (
      typeof params.serverName === 'string' &&
      typeof params.threadId === 'string' &&
      typeof params.message === 'string' &&
      (mode === 'form' || mode === 'url')
    )
  }

  function looksLikePermissionsApprovalRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    return (
      typeof params.threadId === 'string' &&
      typeof params.turnId === 'string' &&
      typeof params.itemId === 'string' &&
      asRecord(params.permissions) !== null
    )
  }

  function readToolRequestUserInputQuestionIds(request: UiServerRequest): string[] {
    if (request.method !== 'item/tool/requestUserInput') return []
    const params = asRecord(request.params)
    const questions = Array.isArray(params?.questions) ? params.questions : []
    const questionIds: string[] = []

    for (const row of questions) {
      const question = asRecord(row)
      const id = readString(question?.id).trim()
      if (id) {
        questionIds.push(id)
      }
    }

    return questionIds
  }

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) {
      nextRows.splice(index, 1, request)
    } else {
      nextRows.push(request)
    }

    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
    pendingServerRequestsRevision += 1
    applyThreadFlags()
  }

  function removePendingServerRequestById(requestId: number): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }
    pendingServerRequestsByThreadId.value = next
    pendingServerRequestsRevision += 1
    applyThreadFlags()
  }

  function replacePendingServerRequests(requests: UiServerRequest[]): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const request of requests) {
      const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
      const current = next[threadId] ?? []
      current.push(request)
      next[threadId] = current
    }

    for (const rows of Object.values(next)) {
      rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
    }

    pendingServerRequestsByThreadId.value = next
    pendingServerRequestsRevision += 1
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (!request) return true
      upsertPendingServerRequest(request)
      return true
    }

    if (notification.method === 'server/request/resolved') {
      const row = asRecord(notification.params)
      const id = row?.id
      if (typeof id === 'number' && Number.isInteger(id)) {
        removePendingServerRequestById(id)
      }
      return true
    }

    return false
  }

  function sanitizeDisplayText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim()
  }

  function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    if (notification.method === 'turn/started') {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/started') {
      const params = asRecord(notification.params)
      const item = asRecord(params?.item)
      const itemType = readString(item?.type).toLowerCase()
      if (itemType === 'reasoning') {
        return {
          threadId,
          activity: {
            label: 'Thinking',
            details: [],
          },
        }
      }
      if (itemType === 'agentmessage') {
        return {
          threadId,
          activity: {
            label: 'Writing response',
            details: [],
          },
        }
      }
      if (itemType === 'commandexecution') {
        const cmd = readString(item?.command)
        return {
          threadId,
          activity: {
            label: 'Running command',
            details: cmd ? [cmd] : [],
          },
        }
      }
      if (itemType === 'filechange') {
        const changes = Array.isArray(item?.changes) ? item.changes : []
        const firstChange = changes[0] as Record<string, unknown> | undefined
        const path = readString(firstChange?.path)
        return {
          threadId,
          activity: {
            label: 'Applying changes',
            details: path ? [path] : [],
          },
        }
      }
    }

    if (notification.method === 'item/commandExecution/outputDelta') {
      return {
        threadId,
        activity: {
          label: 'Running command',
          details: [],
        },
      }
    }

    if (notification.method === 'item/fileChange/outputDelta') {
      return {
        threadId,
        activity: {
          label: 'Applying changes',
          details: [],
        },
      }
    }

    if (
      notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/summaryPartAdded'
    ) {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/agentMessage/delta') {
      return {
        threadId,
        activity: {
          label: 'Writing response',
          details: [],
        },
      }
    }

    return null
  }

  function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
    if (notification.method !== 'turn/started') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    return {
      threadId,
      turnId,
      startedAtMs,
    }
  }

  function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
    if (notification.method !== 'turn/completed') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const completedAtMs =
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined

    return {
      threadId,
      turnId,
      status: readString(turnPayload?.status),
      completedAtMs,
      startedAtMs,
    }
  }

  function liveReasoningMessageId(reasoningItemId: string): string {
    return `${reasoningItemId}:live-reasoning`
  }

  function inferNextTurnIndex(threadId: string): number {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    let maxTurnIndex = -1
    for (const message of persisted) {
      if (typeof message.turnIndex === 'number' && Number.isFinite(message.turnIndex)) {
        maxTurnIndex = Math.max(maxTurnIndex, message.turnIndex)
      }
    }
    return maxTurnIndex + 1
  }

  function setTurnIndexForThread(threadId: string, turnId: string, turnIndex: number): void {
    if (!threadId || !turnId || !Number.isInteger(turnIndex) || turnIndex < 0) return
    const previous = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    if (previous[turnId] === turnIndex) return
    turnIndexByTurnIdByThreadId.value = {
      ...turnIndexByTurnIdByThreadId.value,
      [threadId]: {
        ...previous,
        [turnId]: turnIndex,
      },
    }
  }

  function replaceTurnIndexLookupForThread(threadId: string, nextLookup: Record<string, number>): void {
    const previous = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    const previousEntries = Object.entries(previous)
    const nextEntries = Object.entries(nextLookup)
    if (
      previousEntries.length === nextEntries.length
      && previousEntries.every(([turnId, turnIndex]) => nextLookup[turnId] === turnIndex)
    ) {
      return
    }

    turnIndexByTurnIdByThreadId.value = {
      ...turnIndexByTurnIdByThreadId.value,
      [threadId]: { ...nextLookup },
    }
  }

  function rebindLiveFileChangeTurnIndices(threadId: string): void {
    const current = liveFileChangeMessagesByThreadId.value[threadId]
    if (!current || current.length === 0) return

    const turnIndexByTurnId = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    let changed = false
    const next = current.map((message) => {
      if (typeof message.turnIndex === 'number' || !message.turnId) {
        return message
      }
      const turnIndex = turnIndexByTurnId[message.turnId]
      if (typeof turnIndex !== 'number') return message
      changed = true
      return { ...message, turnIndex }
    })

    if (!changed) return
    liveFileChangeMessagesByThreadId.value = {
      ...liveFileChangeMessagesByThreadId.value,
      [threadId]: next,
    }
  }

  function readReasoningStartedItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return readString(item.id)
    }

    return ''
  }

  function readReasoningDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический источник дельт для UI — уже нормализованный item/*.
    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const itemId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!itemId || !delta) return null
      return { messageId: liveReasoningMessageId(itemId), delta }
    }

    return null
  }

  function readReasoningSectionBreakMessageId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    // Канонический source для section break — item/*
    if (notification.method === 'item/reasoning/summaryPartAdded') {
      const itemId = readString(params.itemId)
      if (!itemId) return ''
      return liveReasoningMessageId(itemId)
    }

    return ''
  }

  function readReasoningCompletedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return liveReasoningMessageId(readString(item.id))
    }

    return ''
  }

  function readAgentMessageStartedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return ''
      return readString(item.id)
    }

    return ''
  }

  function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический live-канал агентского текста.
    if (notification.method === 'item/agentMessage/delta') {
      const messageId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!messageId || !delta) return null
      return { messageId, delta }
    }

    return null
  }

  function readAgentMessageCompleted(notification: RpcNotification): UiMessage | null {
    const params = asRecord(notification.params)
    if (!params) return null

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return null
      const id = readString(item.id)
      const text = readString(item.text)
      if (!id || !text) return null
      return {
        id,
        role: 'assistant',
        text,
        messageType: 'agentMessage.live',
      }
    }

    return null
  }

  function toLocalImageUrl(path: string): string {
    return `/codex-local-image?path=${encodeURIComponent(path)}`
  }

  function toImageGenerationUrl(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/codex-local-image?')
    ) {
      return trimmed
    }
    const compact = trimmed.replace(/\s+/gu, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) return ''
    return `data:image/png;base64,${compact}`
  }

  function readCompletedImageView(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item) return null
    const id = readString(item.id)
    if (!id) return null
    if (item.type === 'imageView') {
      const path = readString(item.path)
      if (!path) return null
      return {
        id,
        role: 'assistant',
        text: '',
        images: [toLocalImageUrl(path)],
        messageType: 'imageView',
      }
    }
    if (item.type !== 'imageGeneration' && item.type !== 'image_generation') return null
    const result = readString(item.result)
    const imageUrl = result ? toImageGenerationUrl(result) : ''
    if (!imageUrl) return null
    return {
      id,
      role: 'assistant',
      text: '',
      images: [imageUrl],
      messageType: 'imageView',

    }
  }

  function readCommandExecutionStarted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/started') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status: 'inProgress', aggregatedOutput: '', exitCode: null },
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCommandOutputDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
    if (notification.method !== 'item/commandExecution/outputDelta') return null
    const params = asRecord(notification.params)
    if (!params) return null
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return null
    return { itemId, delta }
  }

  function readCommandExecutionCompleted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const statusRaw = readString(item.status)
    const status: CommandExecutionData['status'] =
      statusRaw === 'failed' ? 'failed' : statusRaw === 'declined' ? 'declined' : statusRaw === 'interrupted' ? 'interrupted' : 'completed'
    const aggregatedOutput = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status, aggregatedOutput, exitCode },
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCompletedFileChange(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'fileChange') return null
    const id = readString(item.id)
    if (!id) return null
    const threadId = readString(params?.threadId)
    const turnId = readString(params?.turnId)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined

    const fileChanges = toUiFileChanges(item.changes)
    const fileChangeStatus = normalizeFileChangeStatus(item.status)
    if (fileChanges.length === 0 || fileChangeStatus !== 'completed') return null

    return {
      id,
      role: 'system',
      text: '',
      messageType: 'fileChange',
      fileChangeStatus,
      fileChanges,
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function upsertLiveCommand(threadId: string, msg: UiMessage): void {
    const previous = liveCommandsByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, msg)
    if (next === previous) return
    liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
  }

  function removeLiveCommandsPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveCommandsByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((m) => m.id))
    const next = current.filter((m) => !persistedIds.has(m.id))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    } else {
      liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
    }
  }

  function removeLiveFileChangesPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveFileChangeMessagesByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((message) => message.id))
    const persistedTurnIds = new Set(
      persistedMessages
        .filter((message) => message.messageType === 'fileChange' && typeof message.turnId === 'string' && message.turnId.length > 0)
        .map((message) => message.turnId as string),
    )
    const persistedTurnIndices = new Set(
      persistedMessages
        .filter((message) => message.messageType === 'fileChange' && typeof message.turnIndex === 'number')
        .map((message) => message.turnIndex as number),
    )
    const next = current.filter((message) => (
      !persistedIds.has(message.id)
      && !(message.turnId && persistedTurnIds.has(message.turnId))
      && !(typeof message.turnIndex === 'number' && persistedTurnIndices.has(message.turnIndex))
    ))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
    } else {
      liveFileChangeMessagesByThreadId.value = { ...liveFileChangeMessagesByThreadId.value, [threadId]: next }
    }
  }

  function isAgentContentEvent(notification: RpcNotification): boolean {
    if (notification.method === 'item/agentMessage/delta') {
      return true
    }

    const params = asRecord(notification.params)
    if (!params) return false

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      return item?.type === 'agentMessage'
    }

    return false
  }

  function mergeSubagentNotification(parentThreadId: string, notification: RpcNotification): void {
    if (parentThreadId !== selectedThreadId.value) return
    if (notification.method !== 'item/started' && notification.method !== 'item/completed') return

    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (item?.type === 'subAgentActivity') {
      const threadId = readString(item.agentThreadId).trim()
      const agentPath = readString(item.agentPath).trim()
      const kind = readString(item.kind)
      if (!threadId) return

      const existing = subagentsByParentThreadId.value[parentThreadId] ?? []
      const next = existing.map((agent) => ({ ...agent }))
      const index = next.findIndex((agent) => agent.threadId === threadId)
      if (index === -1) {
        next.push({
          threadId,
          prompt: '',
          status: kind === 'started' ? 'running' : kind === 'interrupted' ? 'shutdown' : 'pendingInit',
          message: agentPath,
        })
      } else {
        const agent = next[index]
        if (!agent.message && agentPath) agent.message = agentPath
        if (kind === 'started') agent.status = 'running'
        if (kind === 'interrupted') agent.status = 'shutdown'
      }
      subagentsByParentThreadId.value = {
        ...subagentsByParentThreadId.value,
        [parentThreadId]: next,
      }
      return
    }

    if (
      !item ||
      item.type !== 'collabAgentToolCall' ||
      readString(item.senderThreadId) !== parentThreadId
    ) return

    const receiverThreadIds = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.map((value) => readString(value).trim()).filter(Boolean)
      : []
    if (receiverThreadIds.length === 0) return

    const prompt = readString(item.prompt).trim()
    const agentStates = asRecord(item.agentsStates) ?? {}
    const existing = subagentsByParentThreadId.value[parentThreadId] ?? []
    const next = existing.map((agent) => ({ ...agent }))
    const indexByThreadId = new Map(next.map((agent, index) => [agent.threadId, index]))

    for (const threadId of receiverThreadIds) {
      const state = asRecord(agentStates[threadId])
      const index = indexByThreadId.get(threadId)
      if (index === undefined && item.tool !== 'spawnAgent') continue
      if (index === undefined) {
        indexByThreadId.set(threadId, next.length)
        next.push({
          threadId,
          prompt,
          status: readString(state?.status) || 'pendingInit',
          message: readString(state?.message),
        })
        continue
      }

      const agent = next[index]
      if (!agent.prompt && prompt) agent.prompt = prompt
      if (state) {
        agent.status = readString(state.status) || agent.status
        agent.message = readString(state.message)
      }
    }

    subagentsByParentThreadId.value = {
      ...subagentsByParentThreadId.value,
      [parentThreadId]: next,
    }
  }

  function findSubagentParentThreadId(threadId: string): string {
    for (const [parentThreadId, subagents] of Object.entries(subagentsByParentThreadId.value)) {
      if (subagents.some((subagent) => subagent.threadId === threadId)) return parentThreadId
    }
    return ''
  }

  function applyRealtimeUpdates(notification: RpcNotification): void {
    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (notificationThreadId && discardedSideConversationThreadIds.has(notificationThreadId)) {
      if (notification.method === 'server/request') {
        const request = normalizeServerRequest(notification.params)
        if (request) void rejectSideConversationServerRequest(request).catch(() => {})
      }
      return
    }
    const notificationErrorState = readNotificationErrorState(notification)
    if (!notificationErrorState && notificationThreadId) {
      clearTransientTurnErrorForThread(notificationThreadId)
    }
    if (handleServerRequestNotification(notification)) {
      return
    }

    if (notification.method === 'account/rateLimits/updated') {
      scheduleRateLimitRefresh()
    }

    if (notification.method === 'thread/goal/updated') {
      const params = asRecord(notification.params)
      const goal = normalizeThreadGoal(params?.goal)
      if (goal && readString(params?.threadId) === goal.threadId) {
        applyThreadGoalSnapshot(goal.threadId, goal)
      }
      return
    }

    if (notification.method === 'thread/goal/cleared') {
      const threadId = extractThreadIdFromNotification(notification)
      if (threadId) applyThreadGoalSnapshot(threadId, null)
      return
    }

    if (notification.method === 'thread/name/updated') {
      const params = asRecord(notification.params)
      const threadId = readString(params?.threadId)
      const threadName = readString(params?.threadName)
      if (threadId && threadName && !isKnownSideConversationThread(threadId)) {
        threadTitleById.value = { ...threadTitleById.value, [threadId]: threadName }
        applyThreadFlags()
        void persistThreadTitle(threadId, threadName)
      }
    }

    if (notification.method === 'account/rateLimits/updated') {
      setCodexRateLimit(pickCodexRateLimitSnapshot(notification.params))
      return
    }

    const tokenUsageUpdate = readThreadTokenUsageUpdate(notification)
    if (tokenUsageUpdate) {
      applyTurnTokenUsage(tokenUsageUpdate)
      if (!isKnownSideConversationThread(tokenUsageUpdate.threadId)) {
        setThreadTokenUsage(tokenUsageUpdate.threadId, tokenUsageUpdate.usage)
      }
      return
    }

    const turnActivity = readTurnActivity(notification)
    if (turnActivity) {
      setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    }

    if (notificationThreadId) {
      mergeSubagentNotification(notificationThreadId, notification)
    }

    if (notificationThreadId && (notification.method === 'item/started' || notification.method === 'item/completed')) {
      const params = asRecord(notification.params)
      const item = asRecord(params?.item)
      if (item?.type === 'contextCompaction' && typeof item.id === 'string') {
        const previous = persistedMessagesByThreadId.value[notificationThreadId] ?? []
        const marker: UiMessage = {
          id: item.id,
          role: 'system',
          text: notification.method === 'item/started' ? 'Compacting context…' : 'Context compacted',
          messageType: 'contextCompaction',
          createdAtIso: new Date().toISOString(),
          turnId: readString(params?.turnId) || undefined,
        }
        const index = previous.findIndex((message) => message.id === marker.id)
        setPersistedMessagesForThread(notificationThreadId, index < 0
          ? [...previous, marker]
          : previous.map((message, messageIndex) => messageIndex === index ? { ...message, text: marker.text } : message))
      }
    }

    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      if (isKnownSideConversationThread(startedTurn.threadId)) {
        sideConversationTurnIds.add(startedTurn.turnId)
      }
      nonSuccessCompletionReadBaselineByThreadId.delete(startedTurn.threadId)
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      startTurnTokenThroughput(startedTurn.threadId, startedTurn.turnId)
      setTurnIndexForThread(startedTurn.threadId, startedTurn.turnId, inferNextTurnIndex(startedTurn.threadId))
      activeTurnIdByThreadId.value = {
        ...activeTurnIdByThreadId.value,
        [startedTurn.threadId]: startedTurn.turnId,
      }
      maybeUnblockInterruptForActiveTurn(startedTurn.threadId, startedTurn.turnId)
      clearLivePlansForThread(startedTurn.threadId)
      clearLiveFileChangesForThread(startedTurn.threadId)
      setTurnSummaryForThread(startedTurn.threadId, null)
      setTurnErrorForThread(startedTurn.threadId, null)
      setThreadInProgress(startedTurn.threadId, true)
      if (!isKnownSideConversationThread(startedTurn.threadId)) {
        scheduleQueueStateRefresh(startedTurn.threadId)
      }
      if (eventUnreadByThreadId.value[startedTurn.threadId]) {
        eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, startedTurn.threadId)
      }
    }

    const completedTurn = readTurnCompletedInfo(notification)
    const turnErrorMessage = readTurnErrorMessage(notification)
    const completedThreadId = completedTurn?.threadId ?? extractThreadIdFromNotification(notification)
    const completedThreadModelId = completedThreadId ? readModelIdForThread(completedThreadId) : ''
    const shouldRetryWithFallback =
      Boolean(completedThreadId) &&
      !isKnownSideConversationThread(completedThreadId ?? '') &&
      Boolean(turnErrorMessage) &&
      completedThreadModelId !== MODEL_FALLBACK_ID &&
      isUnsupportedChatGptModelError(new Error(turnErrorMessage))
    if (completedTurn) {
      if (isKnownSideConversationThread(completedTurn.threadId)) {
        if (sideConversationCompletedTurnIds.has(completedTurn.turnId)) return
        sideConversationCompletedTurnIds.add(completedTurn.turnId)
        const activeTurnId = activeTurnIdByThreadId.value[completedTurn.threadId]
        if (activeTurnId && activeTurnId !== completedTurn.turnId) return
        sideConversationTurnIds.add(completedTurn.turnId)
      }
      const pendingTurnRequest = pendingTurnRequestByThreadId.value[completedTurn.threadId]
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) {
        pendingTurnStartsById.delete(completedTurn.turnId)
      }

      const rawDurationMs =
        readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number'
          ? completedTurn.completedAtMs - completedTurn.startedAtMs
          : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)

      const durationMs = typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0
      const throughput = turnTokenThroughputByThreadId.get(completedTurn.threadId)
      const outputTokens = throughput?.turnId === completedTurn.turnId
        ? throughput.outputTokens
        : null
      setTurnSummaryForThread(completedTurn.threadId, {
        turnId: completedTurn.turnId,
        durationMs,
        completedAtIso: new Date(completedTurn.completedAtMs).toISOString(),
        outputTokens: outputTokens && outputTokens > 0 ? outputTokens : undefined,
        inputTokens: throughput?.inputTokens ?? undefined,
        reasoningOutputTokens: throughput?.reasoningOutputTokens ?? undefined,
        prefillDurationMs: throughput?.prefillDurationMs ?? undefined,
        decodeDurationMs: throughput?.decodeDurationMs,
        decodeSegmentCount: throughput?.decodeSegmentCount,
      }, completedTurn.status === 'completed')
      if (activeTurnIdByThreadId.value[completedTurn.threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, completedTurn.threadId)
      }
      clearDelayedTurnSync(completedTurn.threadId)
      const disposition = resolveTurnCompletionDisposition(
        completedTurn.status,
        shouldRetryWithFallback,
        completedTurn.threadId === selectedThreadId.value,
      )
      const isSideConversationTurn = isKnownSideConversationThread(completedTurn.threadId)
      if (!isSideConversationTurn && !shouldRetryWithFallback && completedTurn.status !== 'completed') {
        suppressUnreadForNonSuccessCompletion(completedTurn.threadId)
      }
      if (!disposition.keepRunning) {
        setThreadInProgress(completedTurn.threadId, false)
        setTurnActivityForThread(completedTurn.threadId, null)
      }
      if (!isSideConversationTurn && disposition.markUnread) {
        markThreadUnreadByEvent(completedTurn.threadId)
      }
      if (!shouldRetryWithFallback) {
        clearPendingTurnRequest(completedTurn.threadId)
        if (isSideConversationTurn) {
          const [next, ...remaining] = sideConversationQueuedMessages.value
          if (next && completedTurn.status === 'completed') {
            sideConversationQueuedMessages.value = remaining
            sideConversationCollaborationMode.value = next.collaborationMode
            void sendSideConversationMessage(next.text, next.imageUrls, next.skills, 'steer', next.fileAttachments)
          }
        } else {
          scheduleQueueStateRefresh(completedTurn.threadId)
        }
      }
    }

    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
      }
      if (failedThreadId && isKnownSideConversationThread(failedThreadId)) {
        sideConversationError.value = turnErrorMessage
      } else {
        error.value = turnErrorMessage
      }
      if (failedThreadId && shouldRetryWithFallback && !isKnownSideConversationThread(failedThreadId)) {
        void retryPendingTurnWithFallback(failedThreadId)
      }
    } else if (completedTurn) {
      setTurnErrorForThread(completedTurn.threadId, null)
    }

    if (notificationErrorState) {
      const errorThreadId = notificationThreadId
      const errorThreadModelId = errorThreadId ? readModelIdForThread(errorThreadId) : selectedModelId.value.trim()
      if (errorThreadId) {
        setTurnErrorForThread(errorThreadId, notificationErrorState.message, {
          transient: notificationErrorState.transient,
        })
      }
      if (errorThreadId && isKnownSideConversationThread(errorThreadId)) {
        if (!notificationErrorState.transient) {
          sideConversationError.value = notificationErrorState.message
        }
      } else {
        error.value = notificationErrorState.message
      }
      if (
        !isKnownSideConversationThread(errorThreadId ?? '')
        && errorThreadModelId !== MODEL_FALLBACK_ID
        && isUnsupportedChatGptModelError(new Error(notificationErrorState.message))
      ) {
        if (errorThreadId) {
          void retryPendingTurnWithFallback(errorThreadId)
        } else {
          void applyFallbackModelSelection()
        }
      }
    }

    const planUpdate = readPlanUpdate(notification)
    if (planUpdate) {
      upsertLivePlanMessage(planUpdate.threadId, planUpdate.message)
      setTurnActivityForThread(planUpdate.threadId, {
        label: 'Planning',
        details: planUpdate.message.plan?.steps.map((step) => step.step).slice(0, 2) ?? [],
      })
    }

    const planDelta = readPlanDelta(notification)
    if (planDelta) {
      upsertLivePlanMessage(planDelta.threadId, planDelta.message)
      setTurnActivityForThread(planDelta.threadId, {
        label: 'Planning',
        details: [],
      })
    }

    const selectedThreadIdForNotification = selectedThreadId.value
    const isSelectedSubagent = selectedThreadIdForNotification
      ? (subagentsByParentThreadId.value[selectedThreadIdForNotification] ?? [])
        .some((subagent) => subagent.threadId === notificationThreadId)
      : false
    const isSideConversationThread = isKnownSideConversationThread(notificationThreadId)
    if (!notificationThreadId || (notificationThreadId !== selectedThreadIdForNotification && !isSelectedSubagent && !isSideConversationThread)) return
    const liveAgentTurnId = readString(asRecord(notification.params)?.turnId)
      || activeTurnIdByThreadId.value[notificationThreadId]
      || ''

    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) {
      activeReasoningItemIdByThreadId.delete(notificationThreadId)
    }

    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) {
      observeTurnTextDelta(notificationThreadId, liveAgentTurnId, liveAgentMessageDelta.messageId)
      const existing = (liveAgentMessagesByThreadId.value[notificationThreadId] ?? [])
        .find((message) => message.id === liveAgentMessageDelta.messageId)
      const nextText = `${existing?.text ?? ''}${liveAgentMessageDelta.delta}`
      upsertLiveAgentMessage(notificationThreadId, {
        id: liveAgentMessageDelta.messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'agentMessage.live',
      }, liveAgentTurnId)
    }

    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      upsertLiveAgentMessage(notificationThreadId, completedAgentMessage, liveAgentTurnId)
    }

    const completedImageView = readCompletedImageView(notification)
    if (completedImageView) {
      upsertLiveAgentMessage(notificationThreadId, completedImageView, liveAgentTurnId)

    }

    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      activeReasoningItemIdByThreadId.set(notificationThreadId, startedReasoningItemId)
    }

    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) {
      appendLiveReasoningText(notificationThreadId, liveReasoningDelta.delta)
    }

    const sectionBreakMessageId = readReasoningSectionBreakMessageId(notification)
    if (sectionBreakMessageId) {
      const current = liveReasoningTextByThreadId.value[notificationThreadId] ?? ''
      if (current.trim().length > 0 && !current.endsWith('\n\n')) {
        setLiveReasoningText(notificationThreadId, `${current}\n\n`)
      }
    }

    const completedReasoningMessageId = readReasoningCompletedId(notification)
    if (completedReasoningMessageId) {
      if (completedReasoningMessageId === liveReasoningMessageId(activeReasoningItemIdByThreadId.get(notificationThreadId) ?? '')) {
        activeReasoningItemIdByThreadId.delete(notificationThreadId)
      }
    }

    const commandStarted = readCommandExecutionStarted(notification)
    if (commandStarted) {
      upsertLiveCommand(notificationThreadId, commandStarted)
      setTurnActivityForThread(notificationThreadId, { label: 'Running command', details: [commandStarted.commandExecution?.command ?? ''] })
    }

    const commandDelta = readCommandOutputDelta(notification)
    if (commandDelta) {
      const current = (liveCommandsByThreadId.value[notificationThreadId] ?? []).find((m) => m.id === commandDelta.itemId)
      if (current?.commandExecution) {
        upsertLiveCommand(notificationThreadId, {
          ...current,
          commandExecution: { ...current.commandExecution, aggregatedOutput: `${current.commandExecution.aggregatedOutput}${commandDelta.delta}` },
        })
      }
    }

    const commandCompleted = readCommandExecutionCompleted(notification)
    if (commandCompleted) {
      upsertLiveCommand(notificationThreadId, commandCompleted)
    }

    const completedFileChange = readCompletedFileChange(notification)
    if (completedFileChange) {
      upsertLiveFileChangeMessage(notificationThreadId, completedFileChange)
    }

    if (isAgentContentEvent(notification)) {
      activeReasoningItemIdByThreadId.delete(notificationThreadId)
      clearLiveReasoningForThread(notificationThreadId)
    }

    if (notification.method === 'turn/completed') {
      activeReasoningItemIdByThreadId.delete(notificationThreadId)
      if (notificationThreadId === selectedThreadId.value) {
        shouldAutoScrollOnNextAgentEvent = false
      }
      clearLiveReasoningForThread(notificationThreadId)
      if (liveCommandsByThreadId.value[notificationThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, notificationThreadId)
      }
    }

  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    if (
      notification.method === 'thread/tokenUsage/updated'
      || notification.method === 'thread/goal/updated'
      || notification.method === 'thread/goal/cleared'
    ) return

    const method = notification.method
    const shouldRefreshMessages =
      method === 'turn/started' ||
      method === 'turn/completed' ||
      method === 'error'
    const threadId = extractThreadIdFromNotification(notification)
    const notificationThread = asRecord(asRecord(notification.params)?.thread)
    if (threadId && isKnownSideConversationThread(threadId)) {
      if (shouldRefreshMessages) {
        pendingThreadMessageRefresh.add(threadId)
        if (eventSyncTimer === null && typeof window !== 'undefined') {
          eventSyncTimer = window.setTimeout(() => {
            eventSyncTimer = null
            void syncFromNotifications()
          }, EVENT_SYNC_DEBOUNCE_MS)
        }
      }
      return
    }
    if (notificationThread?.ephemeral === true || (threadId && discardedSideConversationThreadIds.has(threadId))) return
    const parentThreadId = selectedThreadId.value
    const subagentParentThreadId = threadId ? findSubagentParentThreadId(threadId) : ''
    const isKnownSubagent = subagentParentThreadId.length > 0
    const shouldRefreshThreads =
      !isKnownSubagent &&
      (method.startsWith('thread/') || method === 'turn/completed')

    if (!shouldRefreshMessages && !shouldRefreshThreads) return

    if (threadId && shouldRefreshMessages) {
      pendingThreadMessageRefresh.add(threadId)
    }
    if (method === 'turn/completed' && isKnownSubagent) {
      pendingSubagentParentRefresh.add(subagentParentThreadId)
    }
    if (method === 'turn/completed' && subagentParentThreadId === parentThreadId) {
      pendingThreadMessageRefresh.add(parentThreadId)
    }

    if (shouldRefreshThreads) {
      pendingThreadsRefresh = true
      pendingThreadsRefreshForce = true
    }

    if (eventSyncTimer !== null || typeof window === 'undefined') return
    eventSyncTimer = window.setTimeout(() => {
      eventSyncTimer = null
      void syncFromNotifications()
    }, EVENT_SYNC_DEBOUNCE_MS)
  }

  async function hydrateWorkspaceRootsStateIfNeeded(
    groups: UiProjectGroup[],
    rootsState: WorkspaceRootsState | null,
  ): Promise<void> {
    if (hasHydratedWorkspaceRootsState) return
    hasHydratedWorkspaceRootsState = true

    try {
      if (!rootsState) return
      const hydratedOrder: string[] = []
      for (const rootPath of getWorkspaceProjectOrderPaths(rootsState)) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (hydratedOrder.includes(projectName)) continue
        hydratedOrder.push(projectName)
      }

      if (hydratedOrder.length > 0) {
        const mergedOrder = rootsState.projectOrder.length > 0
          ? mergeProjectOrder(hydratedOrder, groups)
          : mergeProjectOrder(projectOrder.value, groups)
        if (!areStringArraysEqual(projectOrder.value, mergedOrder)) {
          projectOrder.value = mergedOrder
        }
      }

      if (Object.keys(rootsState.labels).length > 0 || (rootsState.remoteProjects ?? []).length > 0) {
        const nextLabels = { ...projectDisplayNameById.value }
        let changed = false
        for (const [rootPath, label] of Object.entries(rootsState.labels)) {
          const normalizedRootPath = normalizePathForUi(rootPath).trim()
          const projectNames = [toProjectNameFromWorkspaceRoot(rootPath)]
          if (normalizedRootPath) projectNames.push(normalizedRootPath)
          for (const projectName of projectNames) {
            if (nextLabels[projectName] === label) continue
            nextLabels[projectName] = label
            changed = true
          }
        }
        for (const rootPath of rootsState.order) {
          const leafName = toProjectNameFromWorkspaceRoot(rootPath)
          const parentLeafName = toProjectName(getPathParent(rootPath))
          if (!parentLeafName.startsWith('.') || parentLeafName === leafName) continue
          const displayName = `${leafName} ${parentLeafName}`
          if (nextLabels[leafName] !== undefined || nextLabels[leafName] === displayName) continue
          nextLabels[leafName] = displayName
          changed = true
        }
        for (const remoteProject of rootsState.remoteProjects ?? []) {
          const label = getRemoteProjectDisplayName(remoteProject)
          if (nextLabels[remoteProject.id] === label) continue
          nextLabels[remoteProject.id] = label
          changed = true
        }
        if (changed) {
          projectDisplayNameById.value = nextLabels
        }
      }
    } catch {
      // Keep local storage fallback when global state is unavailable.
    }
  }

  async function loadThreadTitleCacheIfNeeded(options: { force?: boolean } = {}): Promise<void> {
    if (options.force !== true && Object.keys(threadTitleById.value).length > 0) return
    try {
      const cache = await getThreadTitleCache()
      if (Object.keys(cache.titles).length > 0) {
        threadTitleById.value = cache.titles
      }
    } catch {
      // Title cache is optional; keep UI functional.
    }
  }

  async function loadWorkspaceRootsStateForThreadList(): Promise<WorkspaceRootsState | null> {
    try {
      return await getWorkspaceRootsState()
    } catch {
      return null
    }
  }

  async function requestThreadTitleGeneration(threadId: string, prompt: string, cwd: string | null): Promise<void> {
    if (threadTitleById.value[threadId]) return
    const trimmed = prompt.trim()
    if (!trimmed) return
    const truncated = trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed
    try {
      const title = await generateThreadTitle(truncated, cwd)
      if (!title || threadTitleById.value[threadId]) return
      threadTitleById.value = { ...threadTitleById.value, [threadId]: title }
      applyThreadFlags()
      void persistThreadTitle(threadId, title)
    } catch {
      // Title generation is best-effort.
    }
  }

  function filterGroupsByWorkspaceRoots(
    groups: UiProjectGroup[],
    rootsState: WorkspaceRootsState | null,
  ): UiProjectGroup[] {
    const duplicateLeafNames = collectDuplicateProjectLeafNames(groups, rootsState)
    const disambiguatedGroups = disambiguateProjectGroupsByCwd(groups, rootsState)
    const groupsWithWorkspaceRoots = addWorkspaceRootPlaceholderGroups(disambiguatedGroups, rootsState, duplicateLeafNames)
    if (!rootsState || (rootsState.order.length === 0 && (rootsState.remoteProjects ?? []).length === 0)) return groupsWithWorkspaceRoots
    const allowedProjectNames = new Set<string>()
    for (const projectName of getWorkspaceProjectOrderNames(rootsState, duplicateLeafNames)) {
      allowedProjectNames.add(projectName)
    }
    const filteredGroups = groupsWithWorkspaceRoots.filter((group) => {
      if (allowedProjectNames.has(group.projectName)) return true
      return isProjectlessGroup(group)
    })
    return orderGroupsByWorkspaceProjectOrder(filteredGroups, rootsState, duplicateLeafNames)
  }

  function filterSideConversationThread(groups: UiProjectGroup[]): UiProjectGroup[] {
    const threadId = sideConversationThreadId.value
    let filteredGroups = threadId ? removeThreadFromGroups(groups, threadId) : groups
    for (const discardedThreadId of discardedSideConversationThreadIds) {
      filteredGroups = removeThreadFromGroups(filteredGroups, discardedThreadId)
    }
    return filteredGroups
  }

  function applyThreadGroups(groups: UiProjectGroup[], rootsState: WorkspaceRootsState | null): void {
    const sideConversationFilteredGroups = filterSideConversationThread(groups)
    const visibleGroups = filterGroupsByWorkspaceRoots(sideConversationFilteredGroups, rootsState)
    const hasWorkspaceRootsState = Boolean(
      rootsState && (rootsState.order.length > 0 || rootsState.projectOrder.length > 0 || (rootsState.remoteProjects ?? []).length > 0),
    )

    const nextProjectOrder = rootsState?.projectOrder.length
      ? mergeProjectOrder(
        getWorkspaceProjectOrderNames(rootsState, collectDuplicateProjectLeafNames(sideConversationFilteredGroups, rootsState)),
        visibleGroups,
      )
      : mergeProjectOrder(projectOrder.value, visibleGroups)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      if (!hasWorkspaceRootsState) {
        saveProjectOrder(projectOrder.value)
      }
    }

    const orderedGroups = orderGroupsByProjectOrder(visibleGroups, projectOrder.value)
    markServerListedThreads(new Set(flattenThreads(orderedGroups).map((thread) => thread.id)))
    const filteredSourceGroups = filterSideConversationThread(sourceGroups.value)
    const mergedWithInProgress = mergeIncomingWithLocalInProgressThreads(
      filteredSourceGroups,
      orderedGroups,
      inProgressById.value,
    )
    sourceGroups.value = mergeThreadGroups(
      filteredSourceGroups,
      mergedWithInProgress,
    )
    const activeThreadIds = new Set(flattenThreads(sourceGroups.value).map((thread) => thread.id))
    if (sideConversationThreadId.value) activeThreadIds.add(sideConversationThreadId.value)
    syncNonSuccessCompletionReadWatermarks(orderedGroups, activeThreadIds)
    inProgressById.value = pruneThreadStateMap(
      inProgressById.value,
      activeThreadIds,
    )
    applyThreadFlags()
  }

  function normalizeQueueStateForPersistence(state: Record<string, QueuedMessage[]>): ThreadQueueState {
    const next: ThreadQueueState = {}
    for (const [threadId, queue] of Object.entries(state)) {
      const normalizedThreadId = threadId.trim()
      if (!normalizedThreadId || queue.length === 0) continue
      next[normalizedThreadId] = queue.map((message) => ({
        id: message.id,
        text: message.text,
        imageUrls: [...message.imageUrls],
        skills: message.skills.map((skill) => ({ name: skill.name, path: skill.path })),
        fileAttachments: message.fileAttachments.map((attachment) => ({
          label: attachment.label,
          path: attachment.path,
          fsPath: attachment.fsPath,
        })),
        collaborationMode: message.collaborationMode,
      }))
    }
    return next
  }

  function persistQueueState(): void {
    void setThreadQueueState(normalizeQueueStateForPersistence(queuedMessagesByThreadId.value)).catch(() => {
      // Queue persistence is best-effort; keep the current in-memory queue usable.
    })
  }

  async function loadPersistedQueueStateIfNeeded(): Promise<void> {
    if (hasLoadedPersistedQueueState) return
    hasLoadedPersistedQueueState = true
    try {
      queuedMessagesByThreadId.value = await getThreadQueueState()
    } catch {
      // Backend queue state is optional during startup.
    }
  }

  function removeArchivedThreadFromLoadedLists(threadId: string): void {
    loadedThreadListGroups = removeThreadFromGroups(loadedThreadListGroups, threadId)
    sourceGroups.value = removeThreadFromGroups(sourceGroups.value, threadId)
    inProgressById.value = omitKey(inProgressById.value, threadId)
    applyThreadFlags()
  }

  function mergeThreadGroupPages(previous: UiProjectGroup[], incoming: UiProjectGroup[]): UiProjectGroup[] {
    if (previous.length === 0) return incoming
    if (incoming.length === 0) return previous

    const threadById = new Map<string, UiThread>()
    for (const thread of flattenThreads(previous)) {
      threadById.set(thread.id, thread)
    }
    for (const thread of flattenThreads(incoming)) {
      threadById.set(thread.id, thread)
    }
    const groupsByProject = new Map<string, UiThread[]>()
    for (const thread of threadById.values()) {
      const existing = groupsByProject.get(thread.projectName)
      if (existing) existing.push(thread)
      else groupsByProject.set(thread.projectName, [thread])
    }

    return Array.from(groupsByProject.entries())
      .map(([projectName, threads]) => ({
        projectName,
        threads: threads.sort(
          (first, second) => new Date(second.updatedAtIso).getTime() - new Date(first.updatedAtIso).getTime(),
        ),
      }))
      .sort((first, second) => {
        const firstUpdated = new Date(first.threads[0]?.updatedAtIso ?? 0).getTime()
        const secondUpdated = new Date(second.threads[0]?.updatedAtIso ?? 0).getTime()
        return secondUpdated - firstUpdated
      })
  }

  function hasActiveInProgressThreads(): boolean {
    return Object.values(inProgressById.value).some((value) => value === true)
  }

  function scheduleRemainingThreadPages(rootsState: WorkspaceRootsState | null = loadedThreadListRootsState): void {
    if (!threadListNextCursor || isLoadingRemainingThreadPages || hasActiveInProgressThreads()) return

    loadedThreadListRootsState = rootsState

    if (typeof window === 'undefined') {
      void loadRemainingThreadPages(rootsState)
      return
    }

    if (threadListBackgroundTimer !== null) {
      window.clearTimeout(threadListBackgroundTimer)
    }

    threadListBackgroundTimer = window.setTimeout(() => {
      threadListBackgroundTimer = null
      if (!threadListNextCursor || hasActiveInProgressThreads()) return
      void loadRemainingThreadPages(loadedThreadListRootsState)
    }, BACKGROUND_THREAD_PAGINATION_DELAY_MS)
  }

  async function loadRemainingThreadPages(rootsState: WorkspaceRootsState | null): Promise<void> {
    if (isLoadingRemainingThreadPages || !threadListNextCursor || hasActiveInProgressThreads()) return
    isLoadingRemainingThreadPages = true

    try {
      const page = await getThreadGroupsPage(threadListNextCursor, getBackgroundThreadListLimit())
      threadListNextCursor = page.nextCursor
      hasLoadedAllThreadPages = page.nextCursor === null
      isThreadListFullyLoaded.value = hasLoadedAllThreadPages
      loadedThreadListGroups = mergeThreadGroupPages(loadedThreadListGroups, page.groups)
      applyThreadGroups(loadedThreadListGroups, rootsState)
    } catch {
      // Keep the first page usable; a later refresh can retry remaining pages.
    } finally {
      isLoadingRemainingThreadPages = false
      if (threadListNextCursor && !hasActiveInProgressThreads()) {
        scheduleRemainingThreadPages(rootsState)
      }
    }
  }

  async function loadThreads(options: { force?: boolean } = {}) {
    if (loadThreadsPromise) {
      await loadThreadsPromise
      return
    }
    if (
      options.force !== true &&
      hasLoadedThreads.value &&
      Date.now() - lastThreadListLoadAt < RECENT_THREAD_LIST_LOAD_REUSE_MS
    ) {
      return
    }

    loadThreadsPromise = (async () => {
    if (!hasLoadedThreads.value) {
      isLoadingThreads.value = true
    }

    try {
      const [page, rootsState] = await Promise.all([
        getThreadGroupsPage(),
        loadWorkspaceRootsStateForThreadList(),
        loadThreadTitleCacheIfNeeded({ force: options.force === true }),
      ])
      loadedThreadListRootsState = rootsState
      const groups = page.groups
      loadedThreadListGroups = hasLoadedThreads.value
        ? mergeThreadGroupPages(loadedThreadListGroups, groups)
        : groups
      threadListNextCursor = hasLoadedThreads.value && !hasLoadedAllThreadPages
        ? threadListNextCursor
        : page.nextCursor
      hasLoadedAllThreadPages = page.nextCursor === null
      isThreadListFullyLoaded.value = hasLoadedAllThreadPages
      await hydrateWorkspaceRootsStateIfNeeded(groups, rootsState)

      applyThreadGroups(loadedThreadListGroups, rootsState)
      hasLoadedThreads.value = true
      lastThreadListLoadAt = Date.now()
      if (!hasLoadedAllThreadPages) {
        scheduleRemainingThreadPages(rootsState)
      }

      const flatThreads = flattenThreads(projectGroups.value)
      pruneThreadScopedState(flatThreads)

      const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)

      if (!currentExists && !selectedThreadId.value) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
    } finally {
      isLoadingThreads.value = false
    }
    })().finally(() => {
      loadThreadsPromise = null
    })

    await loadThreadsPromise
  }

  async function loadMessages(threadId: string, options: { silent?: boolean; force?: boolean } = {}) {
    if (!threadId) {
      return
    }
    const force = options.force === true || pendingSubagentParentRefresh.has(threadId)
    const recentLoadFailure =
      Date.now() - (lastMessageLoadFailureAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS
    if (!force && turnErrorByThreadId.value[threadId]?.transient && (options.silent === true || recentLoadFailure)) {
      return
    }

    const existingLoad = loadMessagePromiseByThreadId.get(threadId)
    if (existingLoad) {
      const showExistingLoading = options.silent !== true && loadedMessagesByThreadId.value[threadId] !== true
      if (showExistingLoading) {
        loadingMessagesByThreadId.value = { ...loadingMessagesByThreadId.value, [threadId]: true }
      }
      try {
        await existingLoad
      } finally {
        if (showExistingLoading) {
          loadingMessagesByThreadId.value = omitKey(loadingMessagesByThreadId.value, threadId)
        }
      }
      if (force) {
        await loadMessages(threadId, { ...options, force: true })
      }
      return
    }

    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    if (shouldShowLoading) {
      loadingMessagesByThreadId.value = { ...loadingMessagesByThreadId.value, [threadId]: true }
    }

    const loadPromise = (async () => {
      try {
      const version = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const loadedRecently =
        Date.now() - (lastMessageLoadAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS
      const canReuseLoadedMessages =
        !force &&
        alreadyLoaded &&
        (
          loadedRecently ||
          (
            (version.length === 0 || loadedVersion === version) &&
            inProgressById.value[threadId] !== true
          )
        )

      if (canReuseLoadedMessages) {
        markThreadAsRead(threadId)
        return
      }

      // Ephemeral threads have no rollout to resume or history to read. Their
      // transcript belongs to this page and is populated only by live events.
      if (isKnownSideConversationThread(threadId)) {
        const observedTurnId = activeTurnIdByThreadId.value[threadId]
        const summary = await getThreadSummary(threadId)
        if (discardedSideConversationThreadIds.has(threadId)) return
        if (observedTurnId === activeTurnIdByThreadId.value[threadId] && !sideConversationPendingTurnStarts.size) {
          setThreadInProgress(threadId, summary.inProgress)
          if (!summary.inProgress) {
            activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
            setTurnActivityForThread(threadId, null)
          }
        }
        loadedMessagesByThreadId.value = { ...loadedMessagesByThreadId.value, [threadId]: true }
        lastMessageLoadAtByThreadId.set(threadId, Date.now())
        lastMessageLoadFailureAtByThreadId.delete(threadId)
        clearTransientTurnErrorForThread(threadId)
        return
      }

      const needsResume = resumedThreadById.value[threadId] !== true
      const resumePromise = needsResume
        ? resumeThread(threadId).then(result => ({ result, failure: null }), failure => ({ result: null, failure }))
        : null
      let quickTurnIds: Set<string> | null = null
      if (needsResume && !alreadyLoaded && !isKnownSideConversationThread(threadId)) {
        const recent = await getRecentThreadDetail(threadId)
        if (recent && !discardedSideConversationThreadIds.has(threadId)) {
          quickTurnIds = new Set(recent.messages.flatMap((message) => message.turnId ? [message.turnId] : []))
          setPersistedMessagesForThread(threadId, recent.messages)
          replaceTurnIndexLookupForThread(threadId, recent.turnIndexByTurnId)
          hasMoreOlderMessagesByThreadId.value = {
            ...hasMoreOlderMessagesByThreadId.value,
            [threadId]: recent.hasMoreOlder,
          }
          loadedMessagesByThreadId.value = { ...loadedMessagesByThreadId.value, [threadId]: true }
          if (shouldShowLoading) loadingMessagesByThreadId.value = omitKey(loadingMessagesByThreadId.value, threadId)
        }
      }
      const resumeOutcome = resumePromise ? await resumePromise : null
      if (resumeOutcome?.failure && !String(resumeOutcome.failure).includes('already has an active writer')) {
        throw resumeOutcome.failure
      }
      const resumedThread = resumeOutcome?.result ?? null
      const detail = resumedThread ?? await getThreadDetail(threadId)
      if (discardedSideConversationThreadIds.has(threadId)) return

      if (detail.modelProvider) {
        setThreadModelProviderId(threadId, detail.modelProvider)
      }
      if (detail.model) {
        setThreadModelId(threadId, resolveThreadModelForProvider(threadId, detail.model, detail.modelProvider))
      }
      if (resumedThread) {
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const { messages, inProgress: serverInProgress, activeTurnId, turnIndexByTurnId } = detail
      const isSideConversation = isKnownSideConversationThread(threadId)
      if (isSideConversation) {
        for (const message of messages) {
          if (
            message.turnId
            && typeof message.turnIndex === 'number'
            && message.turnIndex >= sideConversationFirstTurnIndex
          ) {
            sideConversationTurnIds.add(message.turnId)
          }
        }
        if (activeTurnId) sideConversationTurnIds.add(activeTurnId)
      }
      const nextMessages = isSideConversation
        ? messages.filter((message) => Boolean(message.turnId && sideConversationTurnIds.has(message.turnId)))
        : messages
      const nextTurnIndexByTurnId = isSideConversation
        ? Object.fromEntries(Object.entries(turnIndexByTurnId).filter(([turnId]) => sideConversationTurnIds.has(turnId)))
        : turnIndexByTurnId
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      const olderLoadedDuringResume = quickTurnIds !== null
        && previousPersisted.some((message) => message.turnId && !quickTurnIds?.has(message.turnId))
      subagentsByParentThreadId.value = {
        ...subagentsByParentThreadId.value,
        [threadId]: detail.subagents ?? [],
      }
      const retainLocalInProgress =
        inProgressById.value[threadId] === true &&
        pendingTurnRequestByThreadId.value[threadId]?.fallbackRetried === true
      const inProgress = serverInProgress || retainLocalInProgress
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: !isSideConversation && (olderLoadedDuringResume
          ? hasMoreOlderMessagesByThreadId.value[threadId] === true
          : detail.hasMoreOlder === true),
      }
      markThreadMessagesPersisted(threadId, nextMessages)
      replaceTurnIndexLookupForThread(threadId, olderLoadedDuringResume
        ? { ...(turnIndexByTurnIdByThreadId.value[threadId] ?? {}), ...nextTurnIndexByTurnId }
        : nextTurnIndexByTurnId)
      rebindLiveFileChangeTurnIndices(threadId)
      const previousToMerge = quickTurnIds
        ? previousPersisted.filter((message) => message.turnId && !quickTurnIds.has(message.turnId))
        : previousPersisted
      const mergedMessages = mergeMessages(previousToMerge, nextMessages, {
        preserveMissing: olderLoadedDuringResume || options.silent === true || hasOptimisticUserMessages(previousPersisted),
        preserveSteering: isSideConversation && serverInProgress,
      })
      setPersistedMessagesForThread(threadId, mergedMessages)

      const previousLiveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
      if (inProgress) {
        const nextLiveAgent = removeRedundantLiveAgentMessages(previousLiveAgent, nextMessages)
        setLiveAgentMessagesForThread(threadId, nextLiveAgent)
      } else {
        clearLiveAgentMessagesForThread(threadId)
      }
      removeLiveCommandsPersistedIn(threadId, nextMessages)
      removeLiveFileChangesPersistedIn(threadId, nextMessages)

      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [threadId]: true,
      }
      lastMessageLoadAtByThreadId.set(threadId, Date.now())
      lastMessageLoadFailureAtByThreadId.delete(threadId)

      if (version) {
        loadedVersionByThreadId.value = {
          ...loadedVersionByThreadId.value,
          [threadId]: version,
        }
      }
      setThreadInProgress(threadId, inProgress)
      clearTransientTurnErrorForThread(threadId)
      if (inProgress && activeTurnId) {
        rememberObservedTurnStart(threadId, activeTurnId, true)
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: activeTurnId,
        }
      } else if (activeTurnIdByThreadId.value[threadId] && !retainLocalInProgress) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      if (!inProgress) {
        clearCompletedTurnLiveState(threadId)
      }
      markThreadAsRead(threadId)
      pendingSubagentParentRefresh.delete(threadId)
      } catch (unknownError) {
        if (discardedSideConversationThreadIds.has(threadId)) return
        const message = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        if (isKnownSideConversationThread(threadId) && /thread.*not found|no rollout found|thread.*not loaded/i.test(message)) {
          setThreadInProgress(threadId, false)
          sideConversationError.value = 'This temporary conversation is no longer available. Close it and open a new side conversation.'
        }
        setTurnErrorForThread(threadId, message, { transient: true })
        lastMessageLoadFailureAtByThreadId.set(threadId, Date.now())
        throw unknownError
      } finally {
      if (shouldShowLoading) {
        loadingMessagesByThreadId.value = omitKey(loadingMessagesByThreadId.value, threadId)
      }
      }
    })().finally(() => {
      loadMessagePromiseByThreadId.delete(threadId)
    })

    loadMessagePromiseByThreadId.set(threadId, loadPromise)
    await loadPromise
  }

  async function loadOlderMessages(threadId: string = selectedThreadId.value): Promise<void> {
    if (!threadId) return
    if (loadingOlderMessagesByThreadId.value[threadId] === true) return
    if (hasMoreOlderMessagesByThreadId.value[threadId] !== true) return

    const beforeTurnId = getFirstPersistedTurnId(threadId)
    if (!beforeTurnId) {
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: false,
      }
      return
    }

    loadingOlderMessagesByThreadId.value = {
      ...loadingOlderMessagesByThreadId.value,
      [threadId]: true,
    }

    try {
      const page = await getOlderThreadMessages(threadId, beforeTurnId)
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      const mergedMessages = mergeMessages(page.messages, previousPersisted, { preserveMissing: true })
      setPersistedMessagesForThread(threadId, mergedMessages)
      replaceTurnIndexLookupForThread(threadId, {
        ...(turnIndexByTurnIdByThreadId.value[threadId] ?? {}),
        ...page.turnIndexByTurnId,
      })
      rebindLiveFileChangeTurnIndices(threadId)
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: page.hasMoreOlder,
      }
    } catch (loadError) {
      error.value = loadError instanceof Error ? loadError.message : 'Failed to load earlier messages'
      throw loadError
    } finally {
      loadingOlderMessagesByThreadId.value = {
        ...loadingOlderMessagesByThreadId.value,
        [threadId]: false,
      }
    }
  }

  async function ensureThreadMessagesLoaded(threadId: string, options: { silent?: boolean } = {}): Promise<void> {
    if (!threadId) return
    if (loadedMessagesByThreadId.value[threadId] === true) return
    if (options.silent === true && turnErrorByThreadId.value[threadId]?.transient) return
    await loadMessages(threadId, options)
  }

  async function refreshSkills(options: { force?: boolean } = {}): Promise<void> {
    const selectedCwd = selectedThread.value?.cwd?.trim() ?? ''
    const skillsLoadKey = selectedCwd || '__global__'
    if (refreshSkillsPromise) {
      await refreshSkillsPromise
      if ((selectedThread.value?.cwd?.trim() || '__global__') === skillsLoadKey) {
        await refreshSkills(options)
      }
      return
    }
    if (
      options.force !== true &&
      hasLoadedSkills &&
      lastSkillsLoadKey === skillsLoadKey &&
      Date.now() - lastSkillsLoadAt < RECENT_SKILLS_LOAD_REUSE_MS
    ) {
      return
    }

    refreshSkillsPromise = (async () => {
      try {
        const skills = await getSkillsList(selectedCwd ? [selectedCwd] : undefined)
        if ((selectedThread.value?.cwd?.trim() || '__global__') !== skillsLoadKey) return
        installedSkills.value = skills
        hasLoadedSkills = true
        lastSkillsLoadAt = Date.now()
        lastSkillsLoadKey = skillsLoadKey
      } catch {
        // keep previous skills on failure
      } finally {
        refreshSkillsPromise = null
      }
    })()

    await refreshSkillsPromise
  }

  async function refreshAncillaryState(
    options: { providerChanged?: boolean; includeProviderModels?: boolean } = {},
  ): Promise<void> {
    await Promise.allSettled([
      refreshModelPreferences({
        providerChanged: options.providerChanged,
        includeProviderModels: options.includeProviderModels,
      }),
      refreshRateLimits(),
      refreshCollaborationModes(),
      refreshSkills(),
    ])
  }

  function scheduleAncillaryStateRefresh(
    options: { providerChanged?: boolean; includeProviderModels?: boolean } = {},
  ): void {
    const run = () => {
      void refreshAncillaryState(options)
    }

    if (typeof window === 'undefined') {
      run()
      return
    }

    window.setTimeout(run, 0)
  }

  async function refreshAll(
    options: { includeSelectedThreadMessages?: boolean; awaitAncillaryRefreshes?: boolean; providerChanged?: boolean; forceThreadRefresh?: boolean } = {},
  ) {
    error.value = ''
    codexCliMissingError.value = ''
    const includeSelectedThreadMessages = options.includeSelectedThreadMessages !== false
    const awaitAncillaryRefreshes = options.awaitAncillaryRefreshes === true

    try {
      await loadPersistedQueueStateIfNeeded()
      await loadThreads({ force: options.forceThreadRefresh === true })
      void loadThreadGoal(selectedThreadId.value)
      if (includeSelectedThreadMessages) {
        const threadId = selectedThreadId.value
        try {
          await loadMessages(threadId)
        } catch (unknownError) {
          if (selectedThreadId.value === threadId) {
            error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
          }
        }
      }
      if (awaitAncillaryRefreshes) {
        await refreshAncillaryState({
          providerChanged: options.providerChanged,
          includeProviderModels: options.providerChanged === true || awaitAncillaryRefreshes,
        })
      } else {
        scheduleAncillaryStateRefresh({
          providerChanged: options.providerChanged,
          includeProviderModels: false,
        })
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (isCodexCliMissingError(unknownError)) {
        codexCliMissingError.value = CODEX_CLI_MISSING_MESSAGE
      } else {
        codexCliMissingError.value = ''
      }
    }
  }

  async function selectThread(threadId: string): Promise<void> {
    setSelectedThreadId(threadId)
    const initialProviderId = readProviderIdForThread(threadId)
    void refreshModelPreferences({ includeProviderModels: true })
    void refreshSkills()

    try {
      await loadMessages(threadId)
      if (selectedThreadId.value === threadId && readProviderIdForThread(threadId) !== initialProviderId) {
        void refreshModelPreferences({ includeProviderModels: true })
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (selectedThreadId.value === threadId) error.value = message
      if (threadId.trim()) {
        setTurnErrorForThread(threadId, message, { transient: true })
      }
    }
  }

  async function archiveThreadById(threadId: string) {
    const wasSelectedThread = selectedThreadId.value === threadId
    const nextSelectedThreadId = wasSelectedThread
      ? findAdjacentThreadId(flattenThreads(projectGroups.value), threadId)
      : ''

    if (wasSelectedThread) {
      setSelectedThreadId(nextSelectedThreadId)
      if (nextSelectedThreadId) {
        void loadMessages(nextSelectedThreadId, { silent: true })
      }
    }

    try {
      await archiveThread(threadId)
      removeArchivedThreadFromLoadedLists(threadId)
      await loadThreads()

      if (wasSelectedThread && nextSelectedThreadId && selectedThreadId.value === nextSelectedThreadId) {
        await ensureThreadMessagesLoaded(nextSelectedThreadId, { silent: true })
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function renameThreadById(threadId: string, threadName: string) {
    const normalizedName = threadName.trim()
    if (!threadId || !normalizedName) return

    try {
      await renameThread(threadId, normalizedName)
      threadTitleById.value = { ...threadTitleById.value, [threadId]: normalizedName }
      applyThreadFlags()
      void persistThreadTitle(threadId, normalizedName)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function forkThreadById(threadId: string): Promise<string> {
    const sourceThreadId = threadId.trim()
    if (!sourceThreadId) return ''

    const sourceThread = flattenThreads(sourceGroups.value).find((row) => row.id === sourceThreadId)
    const sourceCwd = sourceThread?.cwd?.trim() ?? ''
    const sourceTitle = sourceThread?.title?.trim() ?? 'Forked chat'
    const selectedModel = readModelIdForThread(sourceThreadId)
    const selectedEffort = readReasoningEffortForThread(sourceThreadId) || 'medium'
    error.value = ''

    try {
      const forkedThread = await forkThread(sourceThreadId, sourceCwd || undefined, selectedModel || undefined)
      const nextThreadId = forkedThread.threadId.trim()
      if (!nextThreadId) return ''

      insertOptimisticThread(nextThreadId, sourceCwd, sourceTitle)
      setThreadModelId(nextThreadId, forkedThread.model)
      setSelectedReasoningEffortForThread(nextThreadId, selectedEffort)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [nextThreadId]: true,
      }
      setSelectedThreadId(nextThreadId)
      await loadThreads()
      await loadMessages(nextThreadId)
      return nextThreadId
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      return ''
    }
  }

  async function forkThreadFromTurn(threadId: string, turnId: string): Promise<string> {
    const normalizedThreadId = threadId.trim()
    const selectedTurnId = turnId.trim()
    if (!normalizedThreadId || !selectedTurnId) return ''

    if (inProgressById.value[normalizedThreadId] === true) {
      error.value = 'Finish the current turn before forking from a response.'
      return ''
    }

    if (loadedMessagesByThreadId.value[normalizedThreadId] !== true) {
      try {
        await loadMessages(normalizedThreadId)
      } catch (unknownError) {
        error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        return ''
      }
    }

    const sourceThread = flattenThreads(sourceGroups.value).find((row) => row.id === normalizedThreadId) ?? null
    const selectedEffort = readReasoningEffortForThread(normalizedThreadId) || 'medium'
    let unverifiedForkId = ''

    try {
      error.value = ''
      const forked = await forkThread(normalizedThreadId, { lastTurnId: selectedTurnId })
      const forkedThreadId = forked.threadId.trim()
      if (!forkedThreadId) return ''
      unverifiedForkId = forkedThreadId

      const forkedCwd = forked.cwd.trim() || sourceThread?.cwd?.trim() || ''
      const forkedThreadTitle = toForkedThreadTitle(sourceThread?.title || sourceThread?.preview || 'Untitled thread')
      const verifiedFork = await getThreadDetail(forkedThreadId)
      const lastVerifiedTurnIndex = Math.max(-1, ...Object.values(verifiedFork.turnIndexByTurnId))
      if (verifiedFork.turnIndexByTurnId[selectedTurnId] !== lastVerifiedTurnIndex) {
        throw new Error('The fork was not trimmed to the selected response.')
      }
      await renameThread(forkedThreadId, forkedThreadTitle)
      unverifiedForkId = ''
      insertOptimisticThread(forkedThreadId, forkedCwd, forkedThreadTitle)
      setThreadModelId(forkedThreadId, forked.model)
      setSelectedReasoningEffortForThread(forkedThreadId, selectedEffort)
      setPersistedMessagesForThread(forkedThreadId, verifiedFork.messages)
      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [forkedThreadId]: true,
      }
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [forkedThreadId]: true,
      }
      clearLivePlansForThread(forkedThreadId)
      setLiveAgentMessagesForThread(forkedThreadId, [])
      clearLiveReasoningForThread(forkedThreadId)
      if (liveCommandsByThreadId.value[forkedThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, forkedThreadId)
      }
      setTurnSummaryForThread(forkedThreadId, null)
      setTurnActivityForThread(forkedThreadId, null)
      setTurnErrorForThread(forkedThreadId, null)
      setThreadInProgress(forkedThreadId, false)

      setSelectedThreadId(forkedThreadId)
      void loadThreads().catch(() => {})
      return forkedThreadId
    } catch (unknownError) {
      let message = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (unverifiedForkId) {
        try {
          await archiveThread(unverifiedForkId)
          removeArchivedThreadFromLoadedLists(unverifiedForkId)
        } catch {
          message += ` The incomplete fork ${unverifiedForkId} could not be archived.`
        }
      }
      error.value = message
      return ''
    }
  }

  async function maybeReplyToPendingUserInputRequest(
    threadId: string,
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<boolean> {
    if (!threadId || !text.trim()) return false
    if (imageUrls.length > 0 || skills.length > 0 || fileAttachments.length > 0) return false

    const requests = pendingServerRequestsByThreadId.value[threadId] ?? []
    const userInputRequests = requests.filter((request) => request.method === 'item/tool/requestUserInput')
    if (userInputRequests.length !== 1) return false

    const [request] = userInputRequests
    const questionIds = readToolRequestUserInputQuestionIds(request)
    if (questionIds.length !== 1) return false

    return respondToPendingServerRequest({
      id: request.id,
      result: {
        answers: {
          [questionIds[0]]: {
            answers: [text.trim()],
          },
        },
      },
    })
  }

  function clearSideConversationThreadState(threadId: string): void {
    if (!threadId) return
    if (savedTurnSummariesByThreadId.value[threadId]) {
      savedTurnSummariesByThreadId.value = omitKey(savedTurnSummariesByThreadId.value, threadId)
      saveTurnSummaries(savedTurnSummariesByThreadId.value)
    }
    persistedMessagesByThreadId.value = omitKey(persistedMessagesByThreadId.value, threadId)
    livePlanMessagesByThreadId.value = omitKey(livePlanMessagesByThreadId.value, threadId)
    liveAgentMessagesByThreadId.value = omitKey(liveAgentMessagesByThreadId.value, threadId)
    liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
    liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
    inProgressById.value = omitKey(inProgressById.value, threadId)
    turnIndexByTurnIdByThreadId.value = omitKey(turnIndexByTurnIdByThreadId.value, threadId)
    turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
    turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
    turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
    activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    pendingServerRequestsByThreadId.value = omitKey(pendingServerRequestsByThreadId.value, threadId)
    pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId)
    queuedMessagesByThreadId.value = omitKey(queuedMessagesByThreadId.value, threadId)
    queueProcessingByThreadId.value = omitKey(queueProcessingByThreadId.value, threadId)
    subagentsByParentThreadId.value = omitKey(subagentsByParentThreadId.value, threadId)
    eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, threadId)
    loadedVersionByThreadId.value = omitKey(loadedVersionByThreadId.value, threadId)
    loadedMessagesByThreadId.value = omitKey(loadedMessagesByThreadId.value, threadId)
    hasMoreOlderMessagesByThreadId.value = omitKey(hasMoreOlderMessagesByThreadId.value, threadId)
    loadingOlderMessagesByThreadId.value = omitKey(loadingOlderMessagesByThreadId.value, threadId)
    resumedThreadById.value = omitKey(resumedThreadById.value, threadId)
    interruptBlockedUntilPersistedByThreadId.value = omitKey(interruptBlockedUntilPersistedByThreadId.value, threadId)
    threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    threadModelProviderByThreadId.value = omitKey(threadModelProviderByThreadId.value, threadId)
    threadTitleById.value = omitKey(threadTitleById.value, threadId)
    threadGoalByThreadId.value = omitKey(threadGoalByThreadId.value, threadId)
    threadGoalObservedAtByThreadId.value = omitKey(threadGoalObservedAtByThreadId.value, threadId)
    threadGoalLoadingByThreadId.value = omitKey(threadGoalLoadingByThreadId.value, threadId)
    threadGoalUpdatingByThreadId.value = omitKey(threadGoalUpdatingByThreadId.value, threadId)
    threadGoalErrorByThreadId.value = omitKey(threadGoalErrorByThreadId.value, threadId)
    threadGoalRevisionByThreadId.delete(threadId)
    loadedThreadGoalIds.delete(threadId)
    turnTokenThroughputByThreadId.delete(threadId)
    setThreadTokenUsage(threadId, null)
    activeReasoningItemIdByThreadId.delete(threadId)
    pendingThreadMessageRefresh.delete(threadId)
    pendingSubagentParentRefresh.delete(threadId)
    for (const [turnId, turn] of pendingTurnStartsById) {
      if (turn.threadId === threadId) pendingTurnStartsById.delete(turnId)
    }
    nonSuccessCompletionReadBaselineByThreadId.delete(threadId)
    lastMessageLoadAtByThreadId.delete(threadId)
    lastMessageLoadFailureAtByThreadId.delete(threadId)
    clearDelayedTurnSync(threadId)
  }

  function setActiveAccountStorageId(accountId: string): void {
    const normalizedAccountId = normalizeAccountStorageId(accountId)
    if (normalizedAccountId === activeAccountStorageId.value) return
    discardSideConversationInBackground()
    activeAccountStorageId.value = normalizedAccountId
    threadGoalRequestEpoch += 1
    threadGoalRequestByThreadId.clear()
    threadGoalByThreadId.value = {}
    threadGoalObservedAtByThreadId.value = {}
    threadGoalLoadingByThreadId.value = {}
    threadGoalUpdatingByThreadId.value = {}
    threadGoalErrorByThreadId.value = {}
    threadGoalRevisionByThreadId.clear()
    loadedThreadGoalIds.clear()
    turnTokenThroughputByThreadId.clear()
    modelPreferencesRequestEpoch += 1
    const threadId = selectedThreadId.value
    selectedModelId.value = readProviderCompatibleSelectedModel(readModelIdForThread(threadId))
    selectedReasoningEffort.value = readReasoningEffortForThread(threadId) || 'medium'
    ensureAvailableReasoningEffort(selectedModelId.value, selectedReasoningEffort.value)
    void loadThreadGoal(threadId, { force: true })
  }

  function rememberDiscardedSideConversationThread(threadId: string): void {
    discardedSideConversationThreadIds.delete(threadId)
    discardedSideConversationThreadIds.add(threadId)
    while (discardedSideConversationThreadIds.size > MAX_DISCARDED_SIDE_CONVERSATION_THREAD_IDS) {
      const oldestThreadId = discardedSideConversationThreadIds.values().next().value
      if (!oldestThreadId) return
      discardedSideConversationThreadIds.delete(oldestThreadId)
    }
  }

  async function rejectSideConversationServerRequest(request: UiServerRequest): Promise<void> {
    await replyToServerRequest(request.id, {
      error: { code: -32000, message: 'Side conversation closed' },
    })
    removePendingServerRequestById(request.id)
  }

  function setSideConversationModel(modelId: string): void {
    sideConversationModelId.value = modelId
  }

  function setSideConversationReasoningEffort(effort: ReasoningEffort | ''): void {
    sideConversationReasoningEffort.value = effort
  }

  function setSideConversationCollaborationMode(mode: CollaborationModeKind): void {
    sideConversationCollaborationMode.value = mode
  }

  function hideSideConversation(): void {
    if (isSideConversationOpen.value) isSideConversationVisible.value = false
  }

  function resetSideConversationState(): void {
    const threadId = sideConversationThreadId.value
    if (threadId) {
      rememberDiscardedSideConversationThread(threadId)
      clearSideConversationThreadState(threadId)
      removeArchivedThreadFromLoadedLists(threadId)
    }
    sideConversationParentThreadId.value = ''
    sideConversationThreadId.value = ''
    sideConversationQueuedMessages.value = []
    isSideConversationVisible.value = false
    sideConversationError.value = ''
    sideConversationModelId.value = ''
    sideConversationReasoningEffort.value = ''
    sideConversationCollaborationMode.value = 'default'
    sideConversationTurnStartPromise = null
    sideConversationPendingTurnStarts.clear()
    sideConversationFirstTurnIndex = 0
    sideConversationTurnIds.clear()
    sideConversationCompletedTurnIds.clear()
    isSideConversationOpening.value = false
  }

  async function openSideConversation(
    parentThreadId: string,
    modelId?: string,
    effort?: ReasoningEffort,
  ): Promise<void> {
    const normalizedParentThreadId = parentThreadId.trim()
    if (!normalizedParentThreadId) return
    if (isSideConversationOpen.value) {
      if (sideConversationParentThreadId.value === normalizedParentThreadId) {
        isSideConversationVisible.value = true
      }
      return
    }
    if (isSideConversationOpening.value) return

    const openEpoch = ++sideConversationEpoch
    let initialModelId = readModelIdForThread(normalizedParentThreadId) || modelId || ''
    let initialEffort: ReasoningEffort | '' = effort || readReasoningEffortForThread(normalizedParentThreadId) || ''
    let initialRuntimeProviderId = readRuntimeProviderIdForThread(normalizedParentThreadId)
    let initialCollaborationMode = readSelectedCollaborationMode(
      selectedCollaborationModeByContext.value,
      normalizedParentThreadId,
    )
    sideConversationParentThreadId.value = normalizedParentThreadId
    isSideConversationVisible.value = true
    sideConversationError.value = ''
    isSideConversationOpening.value = true
    try {
      const shouldRestoreParent = (
        !threadModelProviderByThreadId.value[normalizedParentThreadId]
        && loadedMessagesByThreadId.value[normalizedParentThreadId] !== true
      )
      if (shouldRestoreParent) {
        const existingLoad = loadMessagePromiseByThreadId.get(normalizedParentThreadId)
        if (existingLoad) {
          await existingLoad
        } else {
          await loadMessages(normalizedParentThreadId, { silent: true, force: true })
        }
      }
      initialModelId = readModelIdForThread(normalizedParentThreadId) || initialModelId
      initialEffort = readReasoningEffortForThread(normalizedParentThreadId) || initialEffort
      initialRuntimeProviderId = readRuntimeProviderIdForThread(normalizedParentThreadId) || initialRuntimeProviderId
      initialCollaborationMode = readSelectedCollaborationMode(
        selectedCollaborationModeByContext.value,
        normalizedParentThreadId,
      )
      if (openEpoch !== sideConversationEpoch) return
      sideConversationFirstTurnIndex = inferNextTurnIndex(normalizedParentThreadId)

      const adoptSideConversationThread = (threadId: string): void => {
        if (openEpoch !== sideConversationEpoch) {
          rememberDiscardedSideConversationThread(threadId)
          clearSideConversationThreadState(threadId)
          removeArchivedThreadFromLoadedLists(threadId)
          void discardSideConversationThreadInBackground(threadId)
          return
        }
        sideConversationThreadId.value = threadId
        sideConversationModelId.value = initialModelId
        sideConversationReasoningEffort.value = initialEffort
        sideConversationCollaborationMode.value = initialCollaborationMode
      }
      const started = await startSideConversationThread(
        normalizedParentThreadId,
        initialModelId,
        initialEffort || undefined,
        initialRuntimeProviderId,
        adoptSideConversationThread,
      )
      if (openEpoch === sideConversationEpoch && sideConversationThreadId.value !== started.threadId) {
        adoptSideConversationThread(started.threadId)
      }
    } catch (unknownError) {
      if (openEpoch === sideConversationEpoch) {
        error.value = unknownError instanceof Error
          ? unknownError.message
          : 'Failed to start side conversation'
        resetSideConversationState()
      }
    } finally {
      if (openEpoch === sideConversationEpoch) {
        isSideConversationOpening.value = false
      }
    }
  }

  async function sendSideConversationMessage(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    mode: 'steer' | 'queue' = 'steer',
    fileAttachments: FileAttachment[] = [],
    queueInsertIndex?: number,
  ): Promise<void> {
    const threadId = sideConversationThreadId.value
    const sendEpoch = sideConversationEpoch
    const nextText = text.trim()
    if (!threadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)) return

    if (await maybeReplyToPendingUserInputRequest(threadId, nextText, imageUrls, skills, fileAttachments)) return
    if (sendEpoch !== sideConversationEpoch || sideConversationThreadId.value !== threadId) return
    const isInProgress = inProgressById.value[threadId] === true
    if (isInProgress && mode === 'queue') {
      const queue = sideConversationQueuedMessages.value
      const nextQueue = [...queue]
      nextQueue.splice(queueInsertIndex === undefined ? queue.length : Math.max(0, Math.min(queueInsertIndex, queue.length)), 0, {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: nextText,
        imageUrls,
        skills,
        fileAttachments,
        collaborationMode: sideConversationCollaborationMode.value,
      })
      sideConversationQueuedMessages.value = nextQueue
      return
    }

    appendOptimisticUserMessage(threadId, nextText, imageUrls, skills, fileAttachments, isInProgress)
    sideConversationError.value = ''
    if (!isInProgress) {
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, { label: 'Thinking', details: [] })
      setTurnErrorForThread(threadId, null)
      setThreadInProgress(threadId, true)
    }

    const turnStartPromise = startThreadTurn(
      threadId,
      nextText,
      imageUrls,
      sideConversationModelId.value || undefined,
      sideConversationReasoningEffort.value || undefined,
      skills.length > 0 ? skills : undefined,
      fileAttachments,
      sideConversationCollaborationMode.value,
    )
    sideConversationTurnStartPromise = turnStartPromise
    sideConversationPendingTurnStarts.add(turnStartPromise)
    try {
      const turnId = await turnStartPromise
      if (turnId && sideConversationThreadId.value === threadId && sideConversationTurnStartPromise === turnStartPromise && !sideConversationCompletedTurnIds.has(turnId)) {
        sideConversationTurnIds.add(turnId)
        rememberObservedTurnStart(threadId, turnId)
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: turnId,
        }
      }
    } catch (unknownError) {
      if (sideConversationThreadId.value === threadId && sideConversationTurnStartPromise === turnStartPromise) {
        if (!isInProgress) {
          setThreadInProgress(threadId, false)
          setTurnActivityForThread(threadId, null)
        }
        sideConversationError.value = unknownError instanceof Error
          ? unknownError.message
          : 'Failed to send side conversation message'
      }
    } finally {
      sideConversationPendingTurnStarts.delete(turnStartPromise)
      if (sideConversationTurnStartPromise === turnStartPromise) {
        sideConversationTurnStartPromise = null
      }
    }
  }

  function removeSideConversationQueuedMessage(messageId: string): void {
    sideConversationQueuedMessages.value = sideConversationQueuedMessages.value.filter((item) => item.id !== messageId)
  }

  function reorderSideConversationQueuedMessage(draggedId: string, targetId: string): void {
    const queue = [...sideConversationQueuedMessages.value]
    const from = queue.findIndex((item) => item.id === draggedId)
    const to = queue.findIndex((item) => item.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    queue.splice(to, 0, queue.splice(from, 1)[0])
    sideConversationQueuedMessages.value = queue
  }

  function steerSideConversationQueuedMessage(messageId: string): void {
    const message = sideConversationQueuedMessages.value.find((item) => item.id === messageId)
    if (!message) return
    removeSideConversationQueuedMessage(messageId)
    sideConversationCollaborationMode.value = message.collaborationMode
    void sendSideConversationMessage(message.text, message.imageUrls, message.skills, 'steer', message.fileAttachments)
  }

  async function interruptSideConversationTurn(): Promise<void> {
    const threadId = sideConversationThreadId.value
    if (!threadId || !isSideConversationInProgress.value) return
    await Promise.allSettled([...sideConversationPendingTurnStarts])
    if (sideConversationThreadId.value !== threadId) return
    const turnId = activeTurnIdByThreadId.value[threadId]
    if (!turnId) return
    try {
      await interruptThreadTurn(threadId, turnId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
    } catch (unknownError) {
      sideConversationError.value = unknownError instanceof Error
        ? unknownError.message
        : 'Failed to stop side conversation turn'
    }
  }

  function discardSideConversationInBackground(): void {
    if (!isSideConversationOpen.value && !isSideConversationOpening.value) return

    sideConversationEpoch += 1
    const threadId = sideConversationThreadId.value
    const turnStartPromises = [...sideConversationPendingTurnStarts]
    let turnId = isSideConversationInProgress.value
      ? activeTurnIdByThreadId.value[threadId]
      : ''
    const pendingRequests = [...(pendingServerRequestsByThreadId.value[threadId] ?? [])]
    resetSideConversationState()
    if (!threadId) return

    void (async () => {
      await Promise.allSettled(pendingRequests.map(rejectSideConversationServerRequest))
      const starts = await Promise.allSettled(turnStartPromises)
      for (const start of starts) {
        if (start.status === 'fulfilled' && start.value) turnId = start.value
      }
      await discardSideConversationThreadInBackground(threadId, turnId)
    })()
  }

  function endSideConversation(): void {
    discardSideConversationInBackground()
  }

  function discardSideConversationOnPageHide(): void {
    const threadId = sideConversationThreadId.value
    const turnId = activeTurnIdByThreadId.value[threadId]
    sideConversationEpoch += 1
    resetSideConversationState()
    if (threadId) discardSideConversationThreadOnPageHide(threadId, turnId)
  }

  async function sendMessageToSelectedThread(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    mode: 'steer' | 'queue' = 'steer',
    fileAttachments: FileAttachment[] = [],
    queueInsertIndex?: number,
    collaborationModeOverride?: CollaborationModeKind,
  ): Promise<void> {
    if (isUpdatingSpeedMode.value) return

    const threadId = selectedThreadId.value
    const nextText = text.trim()
    if (!threadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)) return

    if (await maybeReplyToPendingUserInputRequest(threadId, nextText, imageUrls, skills, fileAttachments)) {
      return
    }

    const isInProgress = inProgressById.value[threadId] === true

    if (isInProgress && mode === 'queue') {
      const queue = queuedMessagesByThreadId.value[threadId] ?? []
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const nextQueue = [...queue]
      const insertIndex = typeof queueInsertIndex === 'number'
        ? Math.max(0, Math.min(queueInsertIndex, nextQueue.length))
        : nextQueue.length
      nextQueue.splice(insertIndex, 0, {
        id,
        text: nextText,
        imageUrls,
        skills,
        fileAttachments,
        collaborationMode: collaborationModeOverride === 'plan'
          ? 'plan'
          : collaborationModeOverride === 'default'
            ? 'default'
            : selectedCollaborationMode.value,
      })
      queuedMessagesByThreadId.value = {
        ...queuedMessagesByThreadId.value,
        [threadId]: nextQueue,
      }
      persistQueueState()
      return
    }

    if (isInProgress) {
      shouldAutoScrollOnNextAgentEvent = true
      void startTurnForThread(
        threadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        collaborationModeOverride,
      ).catch((unknownError) => {
        const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        setTurnErrorForThread(threadId, errorMessage)
        error.value = errorMessage
      })
      return
    }

    error.value = ''
    shouldAutoScrollOnNextAgentEvent = true
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(
      threadId,
      {
        label: 'Thinking',
        details: buildPendingTurnDetails(
          readModelIdForThread(threadId),
          readReasoningEffortForThread(threadId) || 'medium',
          collaborationModeOverride === 'plan'
            ? 'plan'
            : collaborationModeOverride === 'default'
              ? 'default'
              : selectedCollaborationMode.value,
        ),
      },
    )
    setTurnErrorForThread(threadId, null)
    setThreadInProgress(threadId, true)

    try {
      await startTurnForThread(
        threadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        collaborationModeOverride,
      )
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      throw unknownError
    }
  }

  async function sendMessageToNewThread(
    text: string,
    cwd: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<string> {
    if (isUpdatingSpeedMode.value) return ''

    const nextText = text.trim()
    const targetCwd = cwd.trim()
    const selectedModel = readModelIdForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT).trim()
    const selectedEffort = readReasoningEffortForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT) || 'medium'
    const selectedMode = selectedCollaborationMode.value
    if (!nextText && imageUrls.length === 0 && fileAttachments.length === 0) return ''

    isSendingMessage.value = true
    error.value = ''
    let threadId = ''

    try {
      try {
        const startedThread = await startThread(targetCwd || undefined, selectedModel || undefined)
        threadId = startedThread.threadId
        setThreadModelId(threadId, startedThread.model)
        setThreadModelProviderId(threadId, startedThread.modelProvider || activeRuntimeProviderId.value)
        setSelectedCollaborationModeForThread(threadId, selectedMode)
      } catch (unknownError) {
        if (selectedModel && selectedModel !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          const fallbackThread = await startThread(targetCwd || undefined, MODEL_FALLBACK_ID)
          threadId = fallbackThread.threadId
          setThreadModelId(threadId, fallbackThread.model)
          setThreadModelProviderId(threadId, fallbackThread.modelProvider || activeRuntimeProviderId.value)
          setSelectedCollaborationModeForThread(threadId, selectedMode)
        } else {
          throw unknownError
        }
      }
      if (!threadId) return ''

      setSelectedReasoningEffortForThread(threadId, selectedEffort)
      insertOptimisticThread(threadId, targetCwd, nextText || '[Image]')
      appendOptimisticUserMessage(threadId, nextText, imageUrls, skills, fileAttachments)
      blockInterruptUntilThreadIsPersisted(threadId)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      setSelectedThreadId(threadId)
      shouldAutoScrollOnNextAgentEvent = true
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(
        threadId,
        {
          label: 'Thinking',
          details: buildPendingTurnDetails(
            readModelIdForThread(threadId),
            selectedEffort,
            selectedMode,
          ),
        },
      )
      setTurnErrorForThread(threadId, null)
      setThreadInProgress(threadId, true)
      const capturedThreadId = threadId
      const capturedCwd = targetCwd || null
      const capturedPrompt = nextText
      void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, selectedMode)
        .catch((unknownError) => {
          shouldAutoScrollOnNextAgentEvent = false
          setThreadInProgress(threadId, false)
          setTurnActivityForThread(threadId, null)
          const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
          setTurnErrorForThread(threadId, errorMessage)
          error.value = errorMessage
        })
        .finally(() => {
          isSendingMessage.value = false
        })
      void requestThreadTitleGeneration(capturedThreadId, capturedPrompt, capturedCwd)
      return threadId
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      if (threadId) {
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (threadId) {
        setTurnErrorForThread(threadId, errorMessage)
      }
      error.value = errorMessage
      isSendingMessage.value = false
      throw unknownError
    }
  }

  async function startTurnForThread(
    threadId: string,
    nextText: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    collaborationModeOverride?: CollaborationModeKind,
  ): Promise<void> {
    const reasoningEffort = readReasoningEffortForThread(threadId) || 'medium'
    const collaborationMode = collaborationModeOverride === 'plan' ? 'plan' : collaborationModeOverride === 'default'
      ? 'default'
      : selectedCollaborationMode.value
    const normalizedText = nextText.trim()
    const normalizedImageUrls = [...imageUrls]
    if (
      normalizedImageUrls.length === 0
      && shouldReuseAttachedImageFromPrompt(normalizedText)
    ) {
      const latestAttachedImageUrl = findLatestUserLocalImageUrl(threadId)
      if (latestAttachedImageUrl) {
        normalizedImageUrls.push(latestAttachedImageUrl)
      }
    }
    const normalizedSkills = skills.map((skill) => ({ name: skill.name, path: skill.path }))
    const normalizedFileAttachments = fileAttachments.map((file) => ({ ...file }))

    setPendingTurnRequest(threadId, {
      text: normalizedText,
      imageUrls: [...normalizedImageUrls],
      skills: normalizedSkills,
      fileAttachments: normalizedFileAttachments,
      effort: reasoningEffort,
      collaborationMode,
      fallbackRetried: false,
    })

    try {
      if (resumedThreadById.value[threadId] !== true) {
        await loadMessagePromiseByThreadId.get(threadId)?.catch(() => {})
      }
      if (resumedThreadById.value[threadId] !== true) {
        const resumedThread = await resumeThread(threadId)
        if (resumedThread.model) {
          setThreadModelId(threadId, resolveThreadModelForProvider(threadId, resumedThread.model, resumedThread.modelProvider))
        }
        if (resumedThread.modelProvider) {
          setThreadModelProviderId(threadId, resumedThread.modelProvider)
        }
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }
      const modelId = readModelIdForThread(threadId)

      let startedTurnId = ''
      try {
        startedTurnId = await startThreadTurn(
          threadId,
          nextText,
          normalizedImageUrls,
          modelId || undefined,
          reasoningEffort || undefined,
          skills.length > 0 ? skills : undefined,
          fileAttachments,
          collaborationMode,
        )
      } catch (unknownError) {
        if (modelId && modelId !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection(threadId)
          setPendingTurnRequest(threadId, {
            text: normalizedText,
            imageUrls: [...normalizedImageUrls],
            skills: normalizedSkills,
            fileAttachments: normalizedFileAttachments,
            effort: reasoningEffort,
            collaborationMode,
            fallbackRetried: true,
          })
          startedTurnId = await startThreadTurn(
            threadId,
            nextText,
            normalizedImageUrls,
            MODEL_FALLBACK_ID,
            reasoningEffort || undefined,
            skills.length > 0 ? skills : undefined,
            fileAttachments,
            collaborationMode,
          )
        } else {
          throw unknownError
        }
      }

      if (startedTurnId) {
        rememberObservedTurnStart(threadId, startedTurnId)
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: startedTurnId,
        }
        maybeUnblockInterruptForActiveTurn(threadId, startedTurnId)
      }

      pendingThreadMessageRefresh.add(threadId)
      await syncFromNotifications()
      scheduleDelayedTurnSync(threadId)
    } catch (unknownError) {
      throw unknownError
    }
  }

  async function processQueuedMessages(threadId: string): Promise<void> {
    if (queueProcessingByThreadId.value[threadId] === true) return
    queueProcessingByThreadId.value = {
      ...queueProcessingByThreadId.value,
      [threadId]: true,
    }
    try {
      queuedMessagesByThreadId.value = await getThreadQueueState()
    } catch {
      // Backend queue state is optional during transient bridge failures.
    } finally {
      queueProcessingByThreadId.value = omitKey(queueProcessingByThreadId.value, threadId)
    }
  }

  function scheduleQueueStateRefresh(threadId: string): void {
    void processQueuedMessages(threadId)
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      void processQueuedMessages(threadId)
    }, 650)
  }

  async function interruptSelectedThreadTurn(): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (inProgressById.value[threadId] !== true) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] === true) return
    let turnId = activeTurnIdByThreadId.value[threadId]
    if (!turnId) {
      const { activeTurnId } = await getThreadDetail(threadId)
      turnId = activeTurnId
      if (turnId) {
        rememberObservedTurnStart(threadId, turnId, true)
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: turnId,
        }
      }
    }
    if (!turnId) {
      throw new Error('Could not determine active turn id for interrupt')
    }

    isInterruptingTurn.value = true
    error.value = ''
    try {
      await interruptThreadTurn(threadId, turnId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
    } finally {
      isInterruptingTurn.value = false
    }
  }

  async function rollbackSelectedThread(turnId: string): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (isRollingBack.value) return
    if (!turnId.trim()) return

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const matchedMessage = persisted.find((message) => message.turnId === turnId)
    const turnIndex = typeof matchedMessage?.turnIndex === 'number' ? matchedMessage.turnIndex : -1
    if (turnIndex < 0) return
    const maxTurnIndex = persisted.reduce((max, m) => (typeof m.turnIndex === 'number' && m.turnIndex > max ? m.turnIndex : max), -1)
    if (maxTurnIndex < 0 || turnIndex > maxTurnIndex) return
    const numTurns = maxTurnIndex - turnIndex + 1
    if (numTurns < 1) return

    isRollingBack.value = true
    error.value = ''
    try {
      const threadCwd = selectedThread.value?.cwd?.trim() ?? ''
      if (threadCwd) {
        await revertThreadFileChanges(threadId, turnId, threadCwd)
      }
      const nextMessages = await rollbackThread(threadId, numTurns)
      setPersistedMessagesForThread(threadId, nextMessages)
      setLiveAgentMessagesForThread(threadId, [])
      clearLiveReasoningForThread(threadId)
      if (liveCommandsByThreadId.value[threadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
      }
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to rollback thread'
    } finally {
      isRollingBack.value = false
    }
  }

  let renameProjectTimer: ReturnType<typeof setTimeout> | null = null

  async function persistProjectLabelToGlobalState(projectName: string, displayName: string): Promise<void> {
    try {
      const rootsState = await getWorkspaceRootsState()
      const nextLabels = { ...rootsState.labels }
      let changed = false
      for (const rootPath of rootsState.order) {
        if (!matchesWorkspaceRootProject(rootPath, projectName)) continue
        const trimmed = displayName.trim()
        if (trimmed.length === 0) {
          if (nextLabels[rootPath] !== undefined) {
            delete nextLabels[rootPath]
            changed = true
          }
        } else if (nextLabels[rootPath] !== trimmed) {
          nextLabels[rootPath] = trimmed
          changed = true
        }
      }
      if (changed) {
        await setWorkspaceRootsState({
          order: rootsState.order,
          labels: nextLabels,
          active: rootsState.active,
          projectOrder: rootsState.projectOrder,
        })
      }
    } catch {
      // Keep localStorage-only rename when global state is unavailable.
    }
  }

  function renameProject(projectName: string, displayName: string): void {
    if (projectName.length === 0) return

    const currentValue = projectDisplayNameById.value[projectName] ?? ''
    if (currentValue === displayName) return

    projectDisplayNameById.value = {
      ...projectDisplayNameById.value,
      [projectName]: displayName,
    }
    saveProjectDisplayNames(projectDisplayNameById.value)

    if (renameProjectTimer !== null) clearTimeout(renameProjectTimer)
    renameProjectTimer = setTimeout(() => {
      renameProjectTimer = null
      void persistProjectLabelToGlobalState(projectName, displayName)
    }, 500)
  }

  async function removeProject(projectName: string): Promise<void> {
    if (projectName.length === 0) return

    const nextProjectOrder = projectOrder.value.filter((name) => name !== projectName)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }

    sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)

    if (projectDisplayNameById.value[projectName] !== undefined) {
      const nextDisplayNames = { ...projectDisplayNameById.value }
      delete nextDisplayNames[projectName]
      projectDisplayNameById.value = nextDisplayNames
      saveProjectDisplayNames(nextDisplayNames)
    }

    applyThreadFlags()

    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)

    const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)
    if (!currentExists) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }

    const removedRootPaths = new Set<string>()
    try {
      const rootsState = await getWorkspaceRootsState()
      collectWorkspaceRootPathsForProjectRemoval(rootsState, projectName).forEach((rootPath) => {
        removedRootPaths.add(rootPath)
      })
    } catch {
      // Keep local-only removal when global state is unavailable.
    }

    if (removedRootPaths.size > 0) {
      try {
        const rootsState = await getWorkspaceRootsState()
        const nextOrder = rootsState.order.filter((rootPath) => !removedRootPaths.has(rootPath))
        const nextActive = rootsState.active.filter((rootPath) => !removedRootPaths.has(rootPath))
        const fallbackActive = nextActive.length === 0 && nextOrder.length > 0
          ? [nextOrder[0]]
          : nextActive
        await setWorkspaceRootsState({
          order: nextOrder,
          labels: omitKeys(rootsState.labels, removedRootPaths),
          active: fallbackActive,
          projectOrder: rootsState.projectOrder.filter((item) => item !== projectName && !removedRootPaths.has(item)),
        })
        return
      } catch {
        // Fall back to order-only persistence if direct removal fails.
      }
    }

    await persistProjectOrderToWorkspaceRoots().catch(() => undefined)
  }

  function reorderProject(projectName: string, toIndex: number): void {
    if (projectName.length === 0) return
    if (sourceGroups.value.length === 0) return

    const visibleOrder = sourceGroups.value.map((group) => group.projectName)
    const fromIndex = visibleOrder.indexOf(projectName)
    if (fromIndex === -1) return

    const clampedToIndex = Math.max(0, Math.min(toIndex, visibleOrder.length - 1))
    const reorderedVisibleOrder = reorderStringArray(visibleOrder, fromIndex, clampedToIndex)
    if (reorderedVisibleOrder === visibleOrder) return

    const normalizedProjectOrder = mergeProjectOrder(reorderedVisibleOrder, sourceGroups.value)
    projectOrder.value = normalizedProjectOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots().catch(() => undefined)
  }

  async function pinProjectToTop(projectName: string): Promise<void> {
    const normalizedName = projectName.trim()
    if (!normalizedName) return
    const nextOrder = [normalizedName, ...projectOrder.value.filter((name) => name !== normalizedName)]
    if (!areStringArraysEqual(projectOrder.value, nextOrder)) {
      projectOrder.value = nextOrder
      saveProjectOrder(projectOrder.value)

      const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
      sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
      applyThreadFlags()
    }
    await persistProjectOrderToWorkspaceRoots()
  }

  async function persistProjectOrderToWorkspaceRoots(): Promise<void> {
    const rootsState = await getWorkspaceRootsState()
    const nextState = buildWorkspaceRootsProjectOrderState(rootsState, projectOrder.value, sourceGroups.value)

    await setWorkspaceRootsState({
      order: nextState.order,
      labels: rootsState.labels,
      active: nextState.active,
      projectOrder: nextState.projectOrder,
    })
  }

  async function syncThreadStatus(): Promise<void> {
    if (isPolling.value) return
    isPolling.value = true

    try {
      await loadThreads()

      if (!selectedThreadId.value) return

      const threadId = selectedThreadId.value
      const currentVersion = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion
      const isInProgress = inProgressById.value[threadId] === true

      if (isInProgress || hasVersionChange) {
        await loadMessages(threadId, { silent: true })
      }
    } catch {
      // ignore poll failures and keep last known state
    } finally {
      isPolling.value = false
    }
  }

  async function syncFromNotifications(): Promise<void> {
    if (isPolling.value) {
      if (typeof window !== 'undefined' && eventSyncTimer === null) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
      return
    }

    isPolling.value = true

    const shouldRefreshThreads = pendingThreadsRefresh
    const shouldForceThreadRefresh = pendingThreadsRefreshForce
    const threadIdsToRefresh = new Set(pendingThreadMessageRefresh)
    pendingThreadsRefresh = false
    pendingThreadsRefreshForce = false
    pendingThreadMessageRefresh.clear()

    try {
      if (shouldRefreshThreads) {
        await loadThreads({ force: shouldForceThreadRefresh })
      }

      const activeThreadId = selectedThreadId.value
      if (activeThreadId) {
        const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
        const hasPendingSubagentRefresh = pendingSubagentParentRefresh.has(activeThreadId)
        const isInProgress = inProgressById.value[activeThreadId] === true
        const currentVersion = currentThreadVersion(activeThreadId)
        const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
        const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

        const shouldRefreshActiveThread =
          hasVersionChange ||
          isActiveDirty ||
          hasPendingSubagentRefresh ||
          (isInProgress && loadedMessagesByThreadId.value[activeThreadId] !== true) ||
          (shouldRefreshThreads && loadedMessagesByThreadId.value[activeThreadId] !== true)

        if (shouldRefreshActiveThread) {
          await loadMessages(activeThreadId, {
            silent: true,
            force: hasPendingSubagentRefresh,
          })
        }
      }

      const sideThreadId = sideConversationThreadId.value
      if (sideThreadId && threadIdsToRefresh.has(sideThreadId)) {
        await loadMessages(sideThreadId, { silent: true, force: true })
      }
    } catch {
      // Keep UI stable on transient event sync failures.
    } finally {
      isPolling.value = false

      if (
        (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) &&
        typeof window !== 'undefined' &&
        eventSyncTimer === null
      ) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
    }
  }

  async function recoverBridgeState(
    epoch: number,
    sideThreadId = sideConversationThreadId.value,
  ): Promise<void> {
    await loadPendingServerRequestsFromBridge(epoch)
    if (epoch !== pollingEpoch) return
    loadedThreadGoalIds.clear()
    void loadThreadGoal(selectedThreadId.value, { force: true })
    pendingThreadsRefresh = !hasLoadedThreads.value
    if (
      selectedThreadId.value &&
      loadedMessagesByThreadId.value[selectedThreadId.value] !== true
    ) {
      pendingThreadMessageRefresh.add(selectedThreadId.value)
    }
    if (sideThreadId && sideThreadId === sideConversationThreadId.value) {
      pendingThreadMessageRefresh.add(sideThreadId)
    }
    await syncFromNotifications()
  }

  function startPolling(): void {
    if (typeof window === 'undefined') return

    if (stopNotificationStream) return
    const epoch = ++pollingEpoch
    void loadPendingServerRequestsFromBridge(epoch)
    stopNotificationStream = subscribeCodexNotifications((notification) => {
      if (epoch !== pollingEpoch) return
      if (notification.method === 'ready') {
        clearAllTransientTurnErrors()
        void recoverBridgeState(epoch)
        return
      }
      applyRealtimeUpdates(notification)
      queueEventDrivenSync(notification)
    })
  }

  function loadPendingServerRequestsFromBridge(epoch: number): Promise<void> {
    if (epoch !== pollingEpoch) return Promise.resolve()
    if (pendingServerRequestSnapshotPromise) return pendingServerRequestSnapshotPromise

    const promise = (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const revisionAtStart = pendingServerRequestsRevision
          const rows = await getPendingServerRequests()
          if (epoch !== pollingEpoch) return
          if (pendingServerRequestsRevision !== revisionAtStart) continue

          const normalizedRequests = rows
            .map((row) => normalizeServerRequest(row))
            .filter((request): request is UiServerRequest => request !== null)
          const discardedRequests = normalizedRequests.filter((request) => (
            discardedSideConversationThreadIds.has(request.threadId)
          ))
          if (discardedRequests.length > 0) {
            void Promise.allSettled(discardedRequests.map(rejectSideConversationServerRequest))
          }
          if (pendingServerRequestSnapshotRetryTimer !== null && typeof window !== 'undefined') {
            window.clearTimeout(pendingServerRequestSnapshotRetryTimer)
            pendingServerRequestSnapshotRetryTimer = null
          }
          replacePendingServerRequests(normalizedRequests.filter((request) => (
            !discardedSideConversationThreadIds.has(request.threadId)
          )))
          return
        }
        if (
          epoch === pollingEpoch
          && pendingServerRequestSnapshotRetryTimer === null
          && typeof window !== 'undefined'
        ) {
          pendingServerRequestSnapshotRetryTimer = window.setTimeout(() => {
            pendingServerRequestSnapshotRetryTimer = null
            if (epoch === pollingEpoch) void loadPendingServerRequestsFromBridge(epoch)
          }, EVENT_SYNC_DEBOUNCE_MS)
        }
      } catch {
        // Keep UI usable when pending request endpoint is temporarily unavailable.
      }
    })()
    pendingServerRequestSnapshotPromise = promise
    void promise.finally(() => {
      if (pendingServerRequestSnapshotPromise === promise) {
        pendingServerRequestSnapshotPromise = null
      }
    })
    return promise
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<boolean> {
    try {
      await replyToServerRequest(reply.id, {
        result: reply.result,
        error: reply.error,
      })
      removePendingServerRequestById(reply.id)
      return true
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request'
      return false
    }
  }

  function stopPolling(): void {
    pollingEpoch += 1
    threadGoalRequestEpoch += 1
    threadGoalRequestByThreadId.clear()
    pendingServerRequestSnapshotPromise = null
    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }

    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()
    pendingSubagentParentRefresh.clear()
    pendingTurnStartsById.clear()
    turnTokenThroughputByThreadId.clear()
    nonSuccessCompletionReadBaselineByThreadId.clear()
    if (eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
    if (pendingServerRequestSnapshotRetryTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(pendingServerRequestSnapshotRetryTimer)
      pendingServerRequestSnapshotRetryTimer = null
    }
    if (rateLimitRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(rateLimitRefreshTimer)
      rateLimitRefreshTimer = null
    }
    if (threadListBackgroundTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(threadListBackgroundTimer)
      threadListBackgroundTimer = null
    }
    if (typeof window !== 'undefined') {
      for (const timerId of delayedTurnSyncTimerByThreadId.values()) {
        window.clearTimeout(timerId)
      }
    }
    delayedTurnSyncTimerByThreadId.clear()
    activeReasoningItemIdByThreadId.clear()
    shouldAutoScrollOnNextAgentEvent = false
    persistedMessagesByThreadId.value = {}
    loadedMessagesByThreadId.value = {}
    livePlanMessagesByThreadId.value = {}
    liveAgentMessagesByThreadId.value = {}
    liveReasoningTextByThreadId.value = {}
    liveCommandsByThreadId.value = {}
    liveFileChangeMessagesByThreadId.value = {}
    subagentsByParentThreadId.value = {}
    turnIndexByTurnIdByThreadId.value = {}
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    activeTurnIdByThreadId.value = {}
    interruptBlockedUntilPersistedByThreadId.value = {}
    threadListedByServerById.value = {}
    persistedUserMessageByThreadId.value = {}
    queuedMessagesByThreadId.value = {}
    queueProcessingByThreadId.value = {}
    persistQueueState()
    codexRateLimit.value = null
    threadTokenUsageByThreadId.value = {}
    threadGoalByThreadId.value = {}
    threadGoalObservedAtByThreadId.value = {}
    threadGoalLoadingByThreadId.value = {}
    threadGoalUpdatingByThreadId.value = {}
    threadGoalErrorByThreadId.value = {}
    threadGoalRevisionByThreadId.clear()
    loadedThreadGoalIds.clear()
  }

  const selectedThreadQueuedMessages = computed<QueuedMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []
    return queuedMessagesByThreadId.value[threadId] ?? []
  })

  function removeQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const next = queue.filter((m) => m.id !== messageId)
    queuedMessagesByThreadId.value = next.length > 0
      ? { ...queuedMessagesByThreadId.value, [threadId]: next }
      : omitKey(queuedMessagesByThreadId.value, threadId)
    persistQueueState()
  }

  function reorderQueuedMessage(draggedId: string, targetId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return

    const fromIndex = queue.findIndex((m) => m.id === draggedId)
    const toIndex = queue.findIndex((m) => m.id === targetId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    const next = [...queue]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    queuedMessagesByThreadId.value = {
      ...queuedMessagesByThreadId.value,
      [threadId]: next,
    }
    persistQueueState()
  }

  function steerQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const msg = queue.find((m) => m.id === messageId)
    if (!msg) return
    removeQueuedMessage(messageId)
    setSelectedCollaborationMode(msg.collaborationMode)
    void sendMessageToSelectedThread(msg.text, msg.imageUrls, msg.skills, 'steer', msg.fileAttachments)
  }

  function primeSelectedThread(threadId: string, options: { persist?: boolean } = {}): void {
    setSelectedThreadId(threadId, options)
  }

  return {
    projectGroups,
    projectDisplayNameById,
    selectedThread,
    selectedThreadTokenUsage,
    selectedTurnThroughput,
    selectedThreadGoal,
    selectedThreadGoalObservedAtMs,
    selectedThreadGoalActiveTurnStartedAtMs,
    isSelectedThreadGoalLoading,
    isSelectedThreadGoalUpdating,
    selectedThreadGoalError,
    selectedThreadTerminalOpen,
    isSelectedThreadInterruptPending,
    selectedThreadServerRequests,
    selectedThreadSubagents,
    selectedLiveOverlay,
    getLiveOverlayForThread,
    sideConversationParentThreadId,
    sideConversationThreadId,
    sideConversationMessages,
    sideConversationQueuedMessages,
    sideConversationLiveOverlay,
    sideConversationServerRequests,
    sideConversationError,
    isSideConversationOpen,
    isSideConversationVisible,
    isSideConversationOpening,
    isSideConversationInProgress,
    sideConversationModelId,
    sideConversationReasoningEffort,
    sideConversationCollaborationMode,
    codexQuota,
    selectedThreadId,
    availableCollaborationModes,
    availableModelIds,
    availableModelReasoningEfforts,
    selectedCollaborationMode,
    selectedModelId,
    selectedReasoningEffort,
    selectedSpeedMode,
    codexCliMissingError,
    installedSkills,
    accountRateLimitSnapshots,
    messages,
    hasMoreOlderMessages,
    isLoadingThreads,
    isThreadListFullyLoaded,
    isLoadingMessages,
    isLoadingOlderMessages,
    isSendingMessage,
    isInterruptingTurn,
    isUpdatingSpeedMode,
    isRollingBack,

    error,
    refreshAll,
    refreshSkills,
    selectThread,
    loadMessages,
    loadOlderMessages,
    ensureThreadMessagesLoaded,
    setThreadTerminalOpen,
    toggleSelectedThreadTerminal,
    archiveThreadById,
    renameThreadById,
    forkThreadById,
    forkThreadFromTurn,
    rollbackSelectedThread,

    sendMessageToSelectedThread,
    sendMessageToNewThread,
    interruptSelectedThreadTurn,
    openSideConversation,
    hideSideConversation,
    endSideConversation,
    setSideConversationModel,
    setSideConversationReasoningEffort,
    setSideConversationCollaborationMode,
    sendSideConversationMessage,
    removeSideConversationQueuedMessage,
    reorderSideConversationQueuedMessage,
    steerSideConversationQueuedMessage,
    interruptSideConversationTurn,
    discardSideConversationInBackground,
    discardSideConversationOnPageHide,
    setActiveAccountStorageId,
    selectedThreadQueuedMessages,
    removeQueuedMessage,
    reorderQueuedMessage,
    steerQueuedMessage,
    setSelectedCollaborationMode,
    saveSelectedThreadGoal,
    setSelectedThreadGoalStatus,
    reloadSelectedThreadGoal,
    clearSelectedThreadGoal,
    readModelIdForThread,
    setSelectedModelIdForThread,
    setSelectedModelId,

    setSelectedReasoningEffort,
    updateSelectedSpeedMode,
    respondToPendingServerRequest,
    renameProject,
    removeProject,
    reorderProject,
    pinProjectToTop,
    startPolling,
    stopPolling,
    primeSelectedThread,
  }
}
