import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildWorkspaceRootsProjectOrderState,
  collectWorkspaceRootPathsForProjectRemoval,
  filterGroupsByWorkspaceRoots,
  findAdjacentThreadId,
  removeThreadFromGroups,
  isThreadUnreadByLastRead,
  useDesktopState,
} from './useDesktopState'
import type { UiProjectGroup } from '../types/codex'
import type { WorkspaceRootsState } from '../api/codexGateway'

const gatewayMocks = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  discardSideConversationThread: vi.fn(),
  discardSideConversationThreadInBackground: vi.fn(),
  forkThread: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAvailableCollaborationModes: vi.fn(),
  getAvailableModelIds: vi.fn(),
  getCurrentModelConfig: vi.fn(),
  getPendingServerRequests: vi.fn(),
  getSkillsList: vi.fn(),
  getThreadDetail: vi.fn(),
  getThreadGroupsPage: vi.fn(),
  getThreadQueueState: vi.fn(),
  getThreadTitleCache: vi.fn(),
  getWorkspaceRootsState: vi.fn(),
  generateThreadTitle: vi.fn(),
  interruptThreadTurn: vi.fn(),
  persistThreadTitle: vi.fn(),
  renameThread: vi.fn(),
  replyToServerRequest: vi.fn(),
  resumeThread: vi.fn(),
  revertThreadFileChanges: vi.fn(),
  rollbackThread: vi.fn(),
  setCodexSpeedMode: vi.fn(),
  setThreadQueueState: vi.fn(),
  setWorkspaceRootsState: vi.fn(),
  startThread: vi.fn(),
  startSideConversation: vi.fn(),
  startThreadTurn: vi.fn(),
  subscribeCodexNotifications: vi.fn(),
}))

const pollingCleanups: Array<() => void> = []

vi.mock('../api/codexGateway', () => ({
  ...gatewayMocks,
  getBackgroundThreadListLimit: vi.fn(() => 100),
  pickCodexRateLimitSnapshot: vi.fn(() => null),
}))

function thread(id: string, cwd: string, options: { hasWorktree?: boolean } = {}) {
  return {
    id,
    title: id,
    projectName: cwd ? cwd.split('/').at(-1) || cwd : 'Projectless',
    cwd,
    hasWorktree: options.hasWorktree ?? false,
    createdAtIso: '2026-04-28T00:00:00.000Z',
    updatedAtIso: '2026-04-28T00:00:00.000Z',
    preview: '',
    unread: false,
    inProgress: false,
  }
}

function createStorage(initialStorage: Record<string, string>) {
  const store = new Map(Object.entries(initialStorage))
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  }
}

function installTestWindow(
  initialLocalStorage: Record<string, string> = {},
  initialSessionStorage: Record<string, string> = {},
) {
  vi.stubGlobal('window', {
    localStorage: createStorage(initialLocalStorage),
    sessionStorage: createStorage(initialSessionStorage),
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
  })
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

async function setupTurnLifecycleNotificationState(selectedThreadId: string) {
  installTestWindow()
  let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | undefined
  gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
    notificationHandler = handler as typeof notificationHandler
    return vi.fn()
  })
  gatewayMocks.getPendingServerRequests.mockResolvedValue([])
  gatewayMocks.getThreadGroupsPage.mockResolvedValue({
    groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
    nextCursor: null,
  })

  const state = useDesktopState()
  await state.refreshAll({ includeSelectedThreadMessages: false })
  state.primeSelectedThread(selectedThreadId)
  state.startPolling()
  pollingCleanups.push(() => state.stopPolling())
  expect(notificationHandler).toBeDefined()

  return {
    state,
    emit(notification: { method: string; params?: unknown }) {
      notificationHandler!(notification)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  gatewayMocks.discardSideConversationThread.mockResolvedValue(undefined)
  gatewayMocks.discardSideConversationThreadInBackground.mockResolvedValue(undefined)
  gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-thread-default' })
  gatewayMocks.replyToServerRequest.mockResolvedValue(undefined)
  gatewayMocks.getThreadQueueState.mockResolvedValue({})
  gatewayMocks.setThreadQueueState.mockResolvedValue(undefined)
  gatewayMocks.getThreadTitleCache.mockResolvedValue({ titles: {} })
  gatewayMocks.getWorkspaceRootsState.mockRejectedValue(new Error('no workspace roots state'))
})

afterEach(() => {
  for (const cleanup of pollingCleanups.splice(0)) {
    cleanup()
  }
  vi.unstubAllGlobals()
})

describe('filterGroupsByWorkspaceRoots', () => {
  it('keeps projectless chats visible when workspace roots are configured', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'Projectless',
        threads: [thread('projectless-chat', '')],
      },
      {
        projectName: 'allowed-project',
        threads: [thread('allowed-chat', '/tmp/allowed-project')],
      },
      {
        projectName: 'other-project',
        threads: [thread('other-chat', '/tmp/other-project')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/allowed-project'],
      labels: {},
      active: ['/tmp/allowed-project'],
      projectOrder: [],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      'Projectless',
      'allowed-project',
    ])
  })

  it('keeps workspace roots with the same folder name as separate projects', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'api',
        threads: [
          thread('first-api-chat', '/tmp/first/api'),
          thread('second-api-chat', '/tmp/second/api'),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/first/api', '/tmp/second/api'],
      labels: {},
      active: ['/tmp/first/api', '/tmp/second/api'],
      projectOrder: [],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      '/tmp/first/api',
      '/tmp/second/api',
    ])
  })

  it('uses Codex project-order when workspace roots are hydrated', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('alpha-chat', '/tmp/alpha')],
      },
      {
        projectName: 'beta',
        threads: [thread('beta-chat', '/tmp/beta')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/alpha', '/tmp/beta'],
      labels: {},
      active: ['/tmp/alpha'],
      projectOrder: ['/tmp/beta', '/tmp/alpha'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      'beta',
      'alpha',
    ])
  })

  it('keeps empty duplicate workspace roots visible in Codex project order', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'TestChat',
        threads: [thread('testchat-chat', '/Users/igor/temp/TestChat')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/Users/igor/Documents/New project 2/TestChat', '/Users/igor/temp/TestChat'],
      labels: {},
      active: ['/Users/igor/Documents/New project 2/TestChat', '/Users/igor/temp/TestChat'],
      projectOrder: ['/Users/igor/Documents/New project 2/TestChat', '/Users/igor/temp/TestChat'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.length])).toEqual([
      ['/Users/igor/Documents/New project 2/TestChat', 0],
      ['/Users/igor/temp/TestChat', 1],
    ])
  })

  it('keeps remote projects from Codex project order visible as empty project rows', () => {
    const groups: UiProjectGroup[] = []
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/local-project'],
      labels: {},
      active: ['/tmp/local-project'],
      projectOrder: ['remote-project-id', '/tmp/local-project'],
      remoteProjects: [{
        id: 'remote-project-id',
        hostId: 'remote-ssh-discovered:a1',
        remotePath: '/home/ubuntu',
        label: 'ubuntu',
      }],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.length])).toEqual([
      ['remote-project-id', 0],
      ['local-project', 0],
    ])
  })

  it('keeps managed worktree threads under the matching workspace root project', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codex-web-local',
        threads: [
          thread('main-chat', '/Users/igor/Git-projects/codex-web-local'),
          thread('worktree-chat', '/Users/igor/.codex/worktrees/53e7/codex-web-local', { hasWorktree: true }),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/Users/igor/Git-projects/codex-web-local'],
      labels: {},
      active: ['/Users/igor/Git-projects/codex-web-local'],
      projectOrder: ['/Users/igor/Git-projects/codex-web-local'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.map((row) => row.id)])).toEqual([
      ['codex-web-local', ['main-chat', 'worktree-chat']],
    ])
  })

  it('keeps unregistered managed worktrees under the main root when another managed worktree root is registered', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codex-web-local',
        threads: [
          thread('main-chat', '/Users/igor/Git-projects/codex-web-local'),
          thread('registered-worktree-chat', '/Users/igor/.codex/worktrees/a77f/codex-web-local', { hasWorktree: true }),
          thread('unregistered-worktree-chat', '/Users/igor/.codex/worktrees/53e7/codex-web-local', { hasWorktree: true }),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: [
        '/Users/igor/Git-projects/codex-web-local',
        '/Users/igor/.codex/worktrees/a77f/codex-web-local',
      ],
      labels: {
        '/Users/igor/.codex/worktrees/a77f/codex-web-local': 'codex-web-local2',
      },
      active: ['/Users/igor/Git-projects/codex-web-local'],
      projectOrder: ['/Users/igor/Git-projects/codex-web-local'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.map((row) => row.id)])).toEqual([
      ['/Users/igor/Git-projects/codex-web-local', ['main-chat', 'unregistered-worktree-chat']],
      ['/Users/igor/.codex/worktrees/a77f/codex-web-local', ['registered-worktree-chat']],
    ])
  })

  it('does not group unrelated git worktrees under a same-leaf workspace root project', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codex-web-local',
        threads: [
          thread('main-chat', '/Users/igor/Git-projects/codex-web-local'),
          thread('other-git-worktree-chat', '/tmp/other/.git/worktrees/codex-web-local', { hasWorktree: true }),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/Users/igor/Git-projects/codex-web-local'],
      labels: {},
      active: ['/Users/igor/Git-projects/codex-web-local'],
      projectOrder: ['/Users/igor/Git-projects/codex-web-local'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.map((row) => row.id)])).toEqual([
      ['/Users/igor/Git-projects/codex-web-local', ['main-chat']],
    ])
  })
})

describe('removeThreadFromGroups', () => {
  it('removes an archived thread and drops the now-empty project group', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('keep-alpha', '/tmp/alpha')],
      },
      {
        projectName: 'archived-project',
        threads: [thread('archive-me', '/tmp/archived-project')],
      },
      {
        projectName: 'beta',
        threads: [thread('keep-beta', '/tmp/beta')],
      },
      {
        projectName: 'empty-workspace-root',
        threads: [],
      },
    ]

    expect(removeThreadFromGroups(groups, 'archive-me').map((group) => [
      group.projectName,
      group.threads.map((row) => row.id),
    ])).toEqual([
      ['alpha', ['keep-alpha']],
      ['beta', ['keep-beta']],
      ['empty-workspace-root', []],
    ])
  })

  it('preserves referential identity when the thread is absent', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('keep-alpha', '/tmp/alpha')],
      },
    ]

    expect(removeThreadFromGroups(groups, 'missing-thread')).toBe(groups)
  })
})

describe('workspace roots project persistence helpers', () => {
  it('collects duplicate-path project roots by full path when removing a project', () => {
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/first/api', '/tmp/second/api'],
      labels: {
        '/tmp/first/api': 'First API',
        '/tmp/second/api': 'Second API',
      },
      active: ['/tmp/first/api'],
      projectOrder: ['/tmp/first/api', '/tmp/second/api'],
    }

    expect([...collectWorkspaceRootPathsForProjectRemoval(rootsState, '/tmp/first/api')]).toEqual([
      '/tmp/first/api',
    ])
  })

  it('preserves remote project ids in explicit project order when persisting workspace roots', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'local-project',
        threads: [thread('local-chat', '/tmp/local-project')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/local-project'],
      labels: {},
      active: ['/tmp/local-project'],
      projectOrder: ['remote-project-id', '/tmp/local-project'],
      remoteProjects: [{
        id: 'remote-project-id',
        hostId: 'remote-ssh-discovered:a1',
        remotePath: '/home/ubuntu',
        label: 'ubuntu',
      }],
    }

    expect(buildWorkspaceRootsProjectOrderState(rootsState, ['remote-project-id', 'local-project'], groups)).toEqual({
      order: ['/tmp/local-project'],
      active: ['/tmp/local-project'],
      projectOrder: ['remote-project-id', '/tmp/local-project'],
    })
  })
})

describe('thread unread state helpers', () => {
  const cutoffIso = '2026-05-01T12:00:00.000Z'

  it('uses the initialization cutoff when a thread has no read state', () => {
    expect(isThreadUnreadByLastRead('2026-05-01T11:59:59.000Z', undefined, cutoffIso)).toBe(false)
    expect(isThreadUnreadByLastRead('2026-05-01T12:00:01.000Z', undefined, cutoffIso)).toBe(true)
  })

  it('uses per-thread read state instead of the global cutoff after a thread is read', () => {
    expect(isThreadUnreadByLastRead(
      '2026-05-01T12:30:00.000Z',
      '2026-05-01T12:45:00.000Z',
      cutoffIso,
    )).toBe(false)
    expect(isThreadUnreadByLastRead(
      '2026-05-01T12:50:00.000Z',
      '2026-05-01T12:45:00.000Z',
      cutoffIso,
    )).toBe(true)
  })
})

describe('collaboration mode selection', () => {
  it('can prime an empty selected thread without clearing persisted selection', () => {
    installTestWindow({
      'codex-web-local.selected-thread-id.v1': 'thread-a',
    })

    const state = useDesktopState()

    expect(state.selectedThreadId.value).toBe('thread-a')

    state.primeSelectedThread('', { persist: false })

    expect(state.selectedThreadId.value).toBe('')
    expect(window.localStorage.getItem('codex-web-local.selected-thread-id.v1')).toBe('thread-a')
  })

  it('does not carry plan mode from new chats into existing threads', () => {
    installTestWindow({
      'codex-web-local.collaboration-mode.v1': 'plan',
    })

    const state = useDesktopState()

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.setSelectedCollaborationMode('plan')

    expect(state.selectedCollaborationMode.value).toBe('plan')
    expect(window.localStorage.getItem('codex-web-local.collaboration-mode-by-context.v1')).toBe(null)

    state.primeSelectedThread('thread-a')

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.setSelectedCollaborationMode('plan')
    state.primeSelectedThread('thread-b')

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.primeSelectedThread('thread-a')

    expect(state.selectedCollaborationMode.value).toBe('plan')
  })
})

describe('Codex CLI availability', () => {
  it('surfaces a chat runtime error when the app-server bridge cannot find Codex CLI', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockRejectedValue(new Error('Codex CLI is not available. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'))

    const state = useDesktopState()

    await state.refreshAll({ awaitAncillaryRefreshes: true })

    expect(state.codexCliMissingError.value).toBe('Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.')
  })

  it('clears a previous Codex CLI missing banner when a later refresh fails for another reason', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage
      .mockRejectedValueOnce(new Error('Codex CLI is not available. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'))
      .mockRejectedValueOnce(new Error('Connection lost'))

    const state = useDesktopState()

    await state.refreshAll({ awaitAncillaryRefreshes: true })
    expect(state.codexCliMissingError.value).toBe('Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.')

    await state.refreshAll({ awaitAncillaryRefreshes: true })
    expect(state.error.value).toBe('Connection lost')
    expect(state.codexCliMissingError.value).toBe('')
  })

})

describe('startup request deduplication', () => {
  it('reloads cached thread titles on forced thread refresh', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getThreadTitleCache
      .mockResolvedValueOnce({ titles: {} })
      .mockResolvedValueOnce({ titles: { 'thread-1': 'Imported title' } })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('thread-1')

    await state.refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })

    expect(gatewayMocks.getThreadTitleCache).toHaveBeenCalledTimes(2)
    expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('Imported title')
  })

  it('reuses a just-loaded thread list during startup refresh bursts', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })

    try {
      const state = useDesktopState()
      await state.refreshAll({ includeSelectedThreadMessages: false })
      await state.refreshAll({ includeSelectedThreadMessages: false })

      expect(gatewayMocks.getThreadGroupsPage).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reuses a just-loaded skills list for the same selected cwd', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([
      {
        name: 'example',
        description: 'Example skill',
        path: '/tmp/project/.agents/skills/example/SKILL.md',
        scope: 'project',
        enabled: true,
      },
    ])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5'])

    try {
      const state = useDesktopState()
      state.primeSelectedThread('thread-1')
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

      expect(gatewayMocks.getSkillsList).toHaveBeenCalledTimes(1)
      expect(gatewayMocks.getSkillsList).toHaveBeenCalledWith(['/tmp/project'])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reuses a just-loaded empty skills list for the same selected cwd', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5'])

    try {
      const state = useDesktopState()
      state.primeSelectedThread('thread-1')
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

      expect(gatewayMocks.getSkillsList).toHaveBeenCalledTimes(1)
      expect(state.installedSkills.value).toEqual([])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('bypasses recent thread-list reuse for event-driven thread refreshes', async () => {
    installTestWindow()
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        void Promise.resolve().then(() => callback())
      }
      return 1
    }) as typeof window.setTimeout)
    let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | undefined
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler as typeof notificationHandler
      return vi.fn()
    })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })

    try {
      const state = useDesktopState()
      await state.refreshAll({ includeSelectedThreadMessages: false })
      const callsBeforeNotification = gatewayMocks.getThreadGroupsPage.mock.calls.length
      state.startPolling()
      expect(notificationHandler).toBeDefined()
      notificationHandler!({
        method: 'thread/name/updated',
        params: {
          threadId: 'thread-1',
          threadName: 'Updated title',
        },
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(gatewayMocks.getThreadGroupsPage.mock.calls.length).toBeGreaterThan(callsBeforeNotification)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('turn completion lifecycle', () => {
  it('adds current subAgentActivity notifications to the selected parent', async () => {
    const { state, emit } = await setupTurnLifecycleNotificationState('thread-1')

    emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: {
          id: 'activity-1',
          type: 'subAgentActivity',
          kind: 'started',
          agentThreadId: 'agent-1',
          agentPath: '/root/agent-1',
        },
      },
    })
    emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: {
          id: 'activity-2',
          type: 'subAgentActivity',
          kind: 'interacted',
          agentThreadId: 'agent-1',
          agentPath: '/root/agent-1',
        },
      },
    })
    emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: {
          id: 'activity-3',
          type: 'subAgentActivity',
          kind: 'interacted',
          agentThreadId: 'agent-2',
          agentPath: '/root/agent-2',
        },
      },
    })
    emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: {
          id: 'activity-4',
          type: 'subAgentActivity',
          kind: 'interrupted',
          agentThreadId: 'agent-1',
          agentPath: '/root/agent-1',
        },
      },
    })
    emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: {
          id: 'activity-5',
          type: 'subAgentActivity',
          kind: 'started',
          agentThreadId: '',
          agentPath: '/root/ignored',
        },
      },
    })

    expect(state.selectedThreadSubagents.value).toEqual([
      {
        threadId: 'agent-1',
        prompt: '',
        status: 'shutdown',
        message: '/root/agent-1',
      },
      {
        threadId: 'agent-2',
        prompt: '',
        status: 'pendingInit',
        message: '/root/agent-2',
      },
    ])
  })

  it('keeps a thread running and unread false while fallback retry starts', async () => {
    const { state, emit } = await setupTurnLifecycleNotificationState('thread-1')
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: 'openai',
      messages: [],
      inProgress: true,
      activeTurnId: 'turn-primary',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: 'openai',
      messages: [],
      inProgress: true,
      activeTurnId: 'turn-primary',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    gatewayMocks.rollbackThread.mockResolvedValue([])
    gatewayMocks.interruptThreadTurn.mockRejectedValue(new Error('stop rejected for lifecycle test'))
    let resolveFallbackStart: ((turnId: string) => void) | undefined
    let markFallbackStartSettled: (() => void) | undefined
    const fallbackStartSettled = new Promise<void>((resolve) => {
      markFallbackStartSettled = resolve
    })
    gatewayMocks.startThreadTurn
      .mockResolvedValueOnce('turn-primary')
      .mockImplementationOnce(async () => {
        const turnId = await new Promise<string>((resolve) => {
          resolveFallbackStart = resolve
        })
        markFallbackStartSettled?.()
        return turnId
      })

    await state.sendMessageToSelectedThread('retry this request')
    emit({
      method: 'turn/started',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-primary' },
      },
    })
    emit({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-primary',
          status: 'failed',
          error: { message: 'model is not supported' },
        },
      },
    })

    expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
      inProgress: true,
      unread: false,
    })
    await vi.waitFor(() => {
      expect(gatewayMocks.startThreadTurn).toHaveBeenCalledTimes(2)
    })

    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: 'openai',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    await state.loadMessages('thread-1', { silent: true })

    expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
      inProgress: true,
      unread: false,
    })
    expect(gatewayMocks.startThreadTurn).toHaveBeenLastCalledWith(
      'thread-1',
      'retry this request',
      [],
      'gpt-5.4-mini',
      'medium',
      undefined,
      [],
      'default',
    )
    resolveFallbackStart?.('turn-fallback')
    await fallbackStartSettled
    await flushMicrotasks()

    await state.interruptSelectedThreadTurn()
    expect(gatewayMocks.interruptThreadTurn).toHaveBeenCalledWith('thread-1', 'turn-fallback')
    expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
      inProgress: true,
      unread: false,
    })

    emit({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-fallback', status: 'interrupted' } },
    })
    await flushMicrotasks()

    expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
      inProgress: false,
      unread: false,
    })
    await state.interruptSelectedThreadTurn()
    expect(gatewayMocks.interruptThreadTurn).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.startThreadTurn).toHaveBeenCalledTimes(2)
  })

  it('marks a successful background completion unread', async () => {
    const { state, emit } = await setupTurnLifecycleNotificationState('other-thread')

    emit({
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
    })
    emit({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
    })

    expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
      inProgress: false,
      unread: true,
    })

    const refreshedThread = thread('thread-1', '/tmp/project')
    refreshedThread.updatedAtIso = '2099-01-01T00:00:00.000Z'
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [refreshedThread] }],
      nextCursor: null,
    })
    await state.refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })
    expect(state.projectGroups.value[0]?.threads[0]?.unread).toBe(true)

    gatewayMocks.resumeThread.mockResolvedValue({
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    state.primeSelectedThread('thread-1')
    await state.loadMessages('thread-1')
    expect(state.projectGroups.value[0]?.threads[0]?.unread).toBe(false)
  })

  it('does not mark a selected successful thread unread', async () => {
    const { state, emit } = await setupTurnLifecycleNotificationState('thread-1')

    emit({
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
    })
    emit({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
    })

    expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
      inProgress: false,
      unread: false,
    })
  })

  it('refreshes a background parent after a known subagent completes', async () => {
    const { state, emit } = await setupTurnLifecycleNotificationState('thread-1')
    gatewayMocks.resumeThread.mockResolvedValue({
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      subagents: [{
        threadId: 'agent-1',
        prompt: 'Inspect the gateway',
        status: 'running',
        message: 'Reading files',
      }],
    })
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      subagents: [{
        threadId: 'agent-1',
        prompt: 'Inspect the gateway',
        status: 'completed',
        message: 'Gateway checked',
      }],
    })

    await state.loadMessages('thread-1')
    state.primeSelectedThread('other-thread')
    emit({
      method: 'turn/completed',
      params: { threadId: 'agent-1', turn: { id: 'agent-turn-1', status: 'completed' } },
    })

    state.primeSelectedThread('thread-1')
    await state.loadMessages('thread-1')

    expect(gatewayMocks.getThreadDetail).toHaveBeenCalledWith('thread-1')
    expect(state.selectedThreadSubagents.value).toMatchObject([{
      threadId: 'agent-1',
      status: 'completed',
      message: 'Gateway checked',
    }])
  })

  it.each(['failed', 'interrupted', 'declined', 'timeout', 'future-terminal-status'])(
    'does not mark a background %s completion unread',
    async (status) => {
      const { state, emit } = await setupTurnLifecycleNotificationState('other-thread')

      emit({
        method: 'turn/started',
        params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
      })
      emit({
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status } },
      })

      expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
        inProgress: false,
        unread: false,
      })
    },
  )

  it.each(['failed', 'interrupted', 'declined', 'timeout', 'future-terminal-status'])(
    'keeps a background %s completion read after its refreshed summary advances',
    async (status) => {
      const { state, emit } = await setupTurnLifecycleNotificationState('other-thread')

      emit({
        method: 'turn/started',
        params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
      })
      emit({
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status } },
      })

      const refreshedThread = thread('thread-1', '/tmp/project')
      refreshedThread.updatedAtIso = '2099-01-01T00:00:00.000Z'
      gatewayMocks.getThreadGroupsPage.mockResolvedValue({
        groups: [{ projectName: 'Project', threads: [refreshedThread] }],
        nextCursor: null,
      })
      await state.refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })

      expect(state.projectGroups.value[0]?.threads[0]).toMatchObject({
        inProgress: false,
        unread: false,
      })
    },
  )
})

describe('live error overlay', () => {
  it('shows the default thinking overlay while a selected thread is in progress without activity events', async () => {
    installTestWindow()
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue(null)
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'create todo list app',
          messageType: 'userMessage',
        },
      ],
      inProgress: true,
      activeTurnId: 'turn-1',
      turnIndexByTurnId: {},
      hasMoreOlder: false,
    })

    const state = useDesktopState()
    state.primeSelectedThread('thread-thinking')
    await state.loadMessages('thread-thinking')

    expect(state.selectedLiveOverlay.value).toMatchObject({
      activityLabel: 'Thinking',
      reasoningText: '',
      errorText: '',
    })
  })

  it('keeps a new live error visible when an older persisted turn error exists', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue(null)
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [
        {
          id: 'old-error',
          role: 'system',
          text: 'old persisted failure',
          messageType: 'turnError',
        },
      ],
      inProgress: false,
      activeTurnId: '',
      turnIndexByTurnId: {},
      hasMoreOlder: false,
    })

    const state = useDesktopState()
    state.primeSelectedThread('thread-with-errors')
    await state.loadMessages('thread-with-errors')
    state.startPolling()

    notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: 'thread-with-errors',
        turnId: 'new-turn',
        turn: {
          id: 'new-turn',
          status: 'failed',
          error: { message: 'new live failure' },
        },
      },
    })

    expect(state.selectedLiveOverlay.value?.errorText).toBe('new live failure')
  })

  it('suppresses a live error only after that same error has persisted', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue(null)
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [
        {
          id: 'persisted-error',
          role: 'system',
          text: 'same failure',
          messageType: 'turnError',
        },
      ],
      inProgress: false,
      activeTurnId: '',
      turnIndexByTurnId: {},
      hasMoreOlder: false,
    })

    const state = useDesktopState()
    state.primeSelectedThread('thread-with-persisted-error')
    await state.loadMessages('thread-with-persisted-error')
    state.startPolling()

    notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: 'thread-with-persisted-error',
        turnId: 'same-turn',
        turn: {
          id: 'same-turn',
          status: 'failed',
          error: { message: 'same failure' },
        },
      },
    })

    expect(state.selectedLiveOverlay.value).toBe(null)
  })
})

describe('side conversation lifecycle', () => {
  it('waits for an in-flight parent restore before forking with its model and provider', async () => {
    installTestWindow()
    let resolveResume: (value: unknown) => void = () => {}
    gatewayMocks.resumeThread.mockImplementation(() => new Promise((resolve) => {
      resolveResume = resolve
    }))
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-delayed-provider' })

    const state = useDesktopState()
    state.primeSelectedThread('parent-delayed-provider')
    const loadPromise = state.loadMessages('parent-delayed-provider')
    const openPromise = state.openSideConversation('parent-delayed-provider', 'stale-model', 'medium')

    expect(gatewayMocks.startSideConversation).not.toHaveBeenCalled()
    resolveResume({
      model: 'big-pickle',
      modelProvider: 'opencode_zen',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    await Promise.all([loadPromise, openPromise])

    expect(gatewayMocks.startSideConversation).toHaveBeenCalledWith(
      'parent-delayed-provider',
      'big-pickle',
      'medium',
      'opencode_zen',
    )
  })

  it('does not fork after the parent thread changes during restore', async () => {
    installTestWindow()
    let resolveResume: (value: unknown) => void = () => {}
    gatewayMocks.resumeThread.mockImplementation(() => new Promise((resolve) => {
      resolveResume = resolve
    }))

    const state = useDesktopState()
    state.primeSelectedThread('parent-opening')
    const loadPromise = state.loadMessages('parent-opening')
    const openPromise = state.openSideConversation('parent-opening')
    state.primeSelectedThread('other-thread')
    resolveResume({
      model: 'gpt-5.4',
      modelProvider: 'codex',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    await Promise.all([loadPromise, openPromise])

    expect(gatewayMocks.startSideConversation).not.toHaveBeenCalled()
    expect(state.isSideConversationOpen.value).toBe(false)
  })

  it('does not fork after explicit close during parent restore', async () => {
    installTestWindow()
    let resolveResume: (value: unknown) => void = () => {}
    gatewayMocks.resumeThread.mockImplementation(() => new Promise((resolve) => {
      resolveResume = resolve
    }))

    const state = useDesktopState()
    state.primeSelectedThread('parent-explicit-opening')
    const loadPromise = state.loadMessages('parent-explicit-opening')
    const openPromise = state.openSideConversation('parent-explicit-opening')
    state.endSideConversation()
    resolveResume({
      model: 'gpt-5.4',
      modelProvider: 'codex',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    await Promise.all([loadPromise, openPromise])

    expect(gatewayMocks.startSideConversation).not.toHaveBeenCalled()
    expect(state.isSideConversationOpen.value).toBe(false)
  })

  it('forces provider restore after a recent transient load failure', async () => {
    installTestWindow()
    gatewayMocks.resumeThread
      .mockRejectedValueOnce(new Error('temporary restore failure'))
      .mockResolvedValueOnce({
        model: 'big-pickle',
        modelProvider: 'opencode_zen',
        messages: [],
        inProgress: false,
        activeTurnId: '',
        hasMoreOlder: false,
        turnIndexByTurnId: {},
      })

    const state = useDesktopState()
    state.primeSelectedThread('parent-transient-provider')
    await expect(state.loadMessages('parent-transient-provider')).rejects.toThrow('temporary restore failure')
    await state.openSideConversation('parent-transient-provider', 'big-pickle', 'medium')

    expect(gatewayMocks.resumeThread).toHaveBeenCalledTimes(2)
    expect(gatewayMocks.startSideConversation).toHaveBeenCalledWith(
      'parent-transient-provider',
      'big-pickle',
      'medium',
      'opencode_zen',
    )
  })

  it('forks with the parent thread runtime provider id', async () => {
    installTestWindow()
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'big-pickle',
      modelProvider: 'opencode_zen',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-zen' })

    const state = useDesktopState()
    state.primeSelectedThread('parent-zen')
    await state.loadMessages('parent-zen')
    await state.openSideConversation('parent-zen', 'big-pickle', 'medium')

    expect(gatewayMocks.startSideConversation).toHaveBeenCalledWith(
      'parent-zen',
      'big-pickle',
      'medium',
      'opencode_zen',
    )
  })

  it('uses the creation model and Thinking value for later side turns', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-snapshot' })
    gatewayMocks.startThreadTurn.mockResolvedValue('side-turn')

    const state = useDesktopState()
    state.primeSelectedThread('parent-thread')
    await state.openSideConversation('parent-thread', 'gpt-5.6', 'high')
    state.setSelectedModelId('gpt-5.4-mini')
    state.setSelectedReasoningEffort('low')
    await state.sendSideConversationMessage('question')

    expect(gatewayMocks.startThreadTurn).toHaveBeenCalledWith(
      'side-snapshot',
      'question',
      [],
      'gpt-5.6',
      'high',
      undefined,
      [],
      'default',
    )
  })

  it('does not reload an already restored default-provider parent', async () => {
    installTestWindow()
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.4',
      modelProvider: '',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    gatewayMocks.startSideConversation
      .mockResolvedValueOnce({ threadId: 'side-default-a' })
      .mockResolvedValueOnce({ threadId: 'side-default-b' })

    const state = useDesktopState()
    state.primeSelectedThread('parent-default')
    await state.loadMessages('parent-default')
    await state.openSideConversation('parent-default')
    state.discardSideConversationInBackground()
    await state.openSideConversation('parent-default')

    expect(gatewayMocks.resumeThread).toHaveBeenCalledTimes(1)
  })

  it('clears the UI immediately and cleans up in the background', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-background' })

    const state = useDesktopState()
    await state.openSideConversation('parent-thread')
    state.endSideConversation()

    expect(state.isSideConversationOpen.value).toBe(false)
    expect(state.sideConversationThreadId.value).toBe('')
    expect(gatewayMocks.discardSideConversationThreadInBackground).toHaveBeenCalledWith(
      'side-background',
      '',
    )
    expect(gatewayMocks.discardSideConversationThread).not.toHaveBeenCalled()
  })

  it('hides and reopens the same side conversation without discarding it', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-hidden' })

    const state = useDesktopState()
    await state.openSideConversation('parent-thread', 'gpt-5.6', 'high')
    state.setSideConversationDraft('unsent draft')
    state.hideSideConversation()

    expect(state.isSideConversationOpen.value).toBe(true)
    expect(state.isSideConversationVisible.value).toBe(false)
    expect(state.sideConversationThreadId.value).toBe('side-hidden')
    expect(state.sideConversationDraft.value).toBe('unsent draft')
    expect(gatewayMocks.discardSideConversationThreadInBackground).not.toHaveBeenCalled()
    expect(JSON.parse(window.sessionStorage.getItem('codex-web-local.side-conversation-session.v1')!)).toMatchObject({
      parentThreadId: 'parent-thread',
      childThreadId: 'side-hidden',
      visible: false,
      draft: 'unsent draft',
    })

    await state.openSideConversation('parent-thread')

    expect(state.isSideConversationVisible.value).toBe(true)
    expect(gatewayMocks.startSideConversation).toHaveBeenCalledTimes(1)
  })

  it('restores the visible side conversation from the current tab session', async () => {
    installTestWindow({}, {
      'codex-web-local.side-conversation-session.v1': JSON.stringify({
        parentThreadId: 'parent-thread',
        childThreadId: 'side-restored',
        accountStorageId: '__default__',
        modelId: 'gpt-5.6',
        reasoningEffort: 'high',
        collaborationMode: 'default',
        visible: true,
        draft: 'keep this draft',
      }),
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.6',
      modelProvider: 'codex',
      messages: [],
      inProgress: true,
      activeTurnId: 'side-turn',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      subagents: [],
    })

    const state = useDesktopState()
    state.primeSelectedThread('parent-thread')
    await state.restoreSideConversation()

    expect(gatewayMocks.resumeThread).toHaveBeenCalledWith('side-restored')
    expect(state.isSideConversationOpen.value).toBe(true)
    expect(state.isSideConversationVisible.value).toBe(true)
    expect(state.sideConversationThreadId.value).toBe('side-restored')
    expect(state.sideConversationDraft.value).toBe('keep this draft')
    expect(state.isSideConversationInProgress.value).toBe(true)
  })

  it('ends the side conversation when the main thread changes', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-stays-open' })

    const state = useDesktopState()
    state.primeSelectedThread('parent-thread')
    await state.openSideConversation('parent-thread')
    state.primeSelectedThread('other-main-thread')

    expect(state.isSideConversationOpen.value).toBe(false)
    expect(state.sideConversationParentThreadId.value).toBe('')
    expect(state.sideConversationThreadId.value).toBe('')
    await flushMicrotasks()
    expect(gatewayMocks.discardSideConversationThreadInBackground).toHaveBeenCalledWith(
      'side-stays-open',
      '',
    )
  })

  it('keeps the side conversation open when the parent thread is selected again', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-same-parent' })

    const state = useDesktopState()
    state.primeSelectedThread('parent-thread')
    await state.openSideConversation('parent-thread')
    state.primeSelectedThread('parent-thread')

    expect(state.isSideConversationOpen.value).toBe(true)
    expect(state.sideConversationThreadId.value).toBe('side-same-parent')
    expect(gatewayMocks.discardSideConversationThreadInBackground).not.toHaveBeenCalled()
  })

  it('clears a retrying side error after the next side event', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-reconnect' })

    const state = useDesktopState()
    state.startPolling()
    await state.openSideConversation('parent-thread')
    notificationHandler({
      method: 'turn/started',
      params: { threadId: 'side-reconnect', turn: { id: 'side-reconnect-turn' } },
    })
    notificationHandler({
      method: 'error',
      params: { threadId: 'side-reconnect', message: 'Reconnecting', willRetry: true },
    })

    expect(state.sideConversationLiveOverlay.value?.errorText).toBe('Reconnecting')
    expect(state.sideConversationError.value).toBe('')

    notificationHandler({
      method: 'server/request',
      params: {
        id: 30,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'side-reconnect',
          turnId: 'side-reconnect-turn',
          itemId: 'side-reconnect-item',
        },
      },
    })

    expect(state.sideConversationLiveOverlay.value?.errorText).toBe('')
    expect(state.sideConversationServerRequests.value).toHaveLength(1)
    expect(state.isSideConversationOpen.value).toBe(true)
    state.stopPolling()
  })

  it('refreshes an active side conversation after the notification bridge reconnects', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread
      .mockResolvedValueOnce({
        model: 'gpt-5.6', modelProvider: 'codex', messages: [], inProgress: false,
        activeTurnId: '', hasMoreOlder: false, turnIndexByTurnId: {}, subagents: [],
      })
      .mockResolvedValueOnce({
        model: 'gpt-5.6', modelProvider: 'codex', messages: [], inProgress: false,
        activeTurnId: '', hasMoreOlder: false, turnIndexByTurnId: {}, subagents: [],
      })

    const state = useDesktopState()
    state.primeSelectedThread('parent-thread')
    await state.loadMessages('parent-thread')
    await state.openSideConversation('parent-thread')
    state.startPolling()
    notificationHandler({
      method: 'turn/started',
      params: { threadId: 'side-thread-default', turn: { id: 'side-turn' } },
    })

    expect(state.isSideConversationInProgress.value).toBe(true)
    notificationHandler({ method: 'ready' })
    await flushMicrotasks()

    expect(gatewayMocks.resumeThread).toHaveBeenLastCalledWith('side-thread-default')
    expect(state.isSideConversationInProgress.value).toBe(false)
    state.stopPolling()
  })

  it('rejects pending side requests before background cleanup', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-with-request' })

    const state = useDesktopState()
    state.startPolling()
    await state.openSideConversation('parent-thread')
    notificationHandler({
      method: 'server/request',
      params: {
        id: 31,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'side-with-request', turnId: 'turn-31', itemId: 'item-31' },
      },
    })

    state.discardSideConversationInBackground()
    await flushMicrotasks()

    expect(gatewayMocks.replyToServerRequest).toHaveBeenCalledWith(31, {
      error: { code: -32000, message: 'Side conversation closed' },
    })
    expect(gatewayMocks.discardSideConversationThreadInBackground).toHaveBeenCalledWith(
      'side-with-request',
      '',
    )
  })

  it('rejects discarded side requests restored from the bridge snapshot', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 32,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'side-snapshot', turnId: 'turn-32', itemId: 'item-32' },
      }])
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-snapshot' })

    const state = useDesktopState()
    state.startPolling()
    await state.openSideConversation('parent-thread')
    state.discardSideConversationInBackground()
    notificationHandler({ method: 'ready' })
    await flushMicrotasks()

    expect(gatewayMocks.replyToServerRequest).toHaveBeenCalledWith(32, {
      error: { code: -32000, message: 'Side conversation closed' },
    })
    state.primeSelectedThread('side-snapshot')
    expect(state.selectedThreadServerRequests.value).toEqual([])
  })

  it('does not let an older bridge snapshot overwrite a realtime request', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    let resolveFirstSnapshot: (rows: unknown[]) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstSnapshot = resolve
      }))
      .mockResolvedValueOnce([{
        id: 34,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'current-thread', turnId: 'turn-34', itemId: 'item-34' },
      }])

    const state = useDesktopState()
    state.primeSelectedThread('current-thread')
    state.startPolling()
    notificationHandler({
      method: 'server/request',
      params: {
        id: 34,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'current-thread', turnId: 'turn-34', itemId: 'item-34' },
      },
    })
    resolveFirstSnapshot([])
    await flushMicrotasks()

    expect(gatewayMocks.getPendingServerRequests).toHaveBeenCalledTimes(2)
    expect(state.selectedThreadServerRequests.value).toHaveLength(1)
    expect(state.selectedThreadServerRequests.value[0]?.id).toBe(34)
  })

  it('retries the bridge snapshot after two consecutive realtime conflicts', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    let retrySnapshot: () => void = () => {}
    let resolveFirstSnapshot: (rows: unknown[]) => void = () => {}
    let resolveSecondSnapshot: (rows: unknown[]) => void = () => {}
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') retrySnapshot = () => callback()
      return 1
    }) as typeof window.setTimeout)
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstSnapshot = resolve
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondSnapshot = resolve
      }))
      .mockResolvedValueOnce([
        {
          id: 35,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'current-thread', turnId: 'turn-35', itemId: 'item-35' },
        },
        {
          id: 36,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'current-thread', turnId: 'turn-36', itemId: 'item-36' },
        },
        {
          id: 37,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'current-thread', turnId: 'turn-37', itemId: 'item-37' },
        },
      ])

    const state = useDesktopState()
    state.primeSelectedThread('current-thread')
    state.startPolling()
    notificationHandler({
      method: 'server/request',
      params: {
        id: 36,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'current-thread', turnId: 'turn-36', itemId: 'item-36' },
      },
    })
    resolveFirstSnapshot([])
    await flushMicrotasks()
    notificationHandler({
      method: 'server/request',
      params: {
        id: 37,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'current-thread', turnId: 'turn-37', itemId: 'item-37' },
      },
    })
    resolveSecondSnapshot([])
    await flushMicrotasks()
    retrySnapshot()
    await flushMicrotasks()

    expect(gatewayMocks.getPendingServerRequests).toHaveBeenCalledTimes(3)
    expect(state.selectedThreadServerRequests.value.map((request) => request.id)).toEqual([35, 36, 37])
  })

  it('reuses the startup pending snapshot when ready arrives before it resolves', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    let resolveSnapshot: (rows: unknown[]) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSnapshot = resolve
    }))

    const state = useDesktopState()
    state.startPolling()
    notificationHandler({ method: 'ready' })

    expect(gatewayMocks.getPendingServerRequests).toHaveBeenCalledTimes(1)
    resolveSnapshot([])
    await flushMicrotasks()
    expect(gatewayMocks.getPendingServerRequests).toHaveBeenCalledTimes(1)
    state.stopPolling()
  })

  it('does not schedule a snapshot retry after polling stops', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    let resolveFirstSnapshot: (rows: unknown[]) => void = () => {}
    let resolveSecondSnapshot: (rows: unknown[]) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstSnapshot = resolve
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondSnapshot = resolve
      }))

    const state = useDesktopState()
    state.startPolling()
    notificationHandler({
      method: 'server/request',
      params: {
        id: 38,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'current-thread', turnId: 'turn-38', itemId: 'item-38' },
      },
    })
    resolveFirstSnapshot([])
    await flushMicrotasks()
    notificationHandler({
      method: 'server/request',
      params: {
        id: 39,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'current-thread', turnId: 'turn-39', itemId: 'item-39' },
      },
    })
    vi.mocked(window.setTimeout).mockClear()
    state.stopPolling()
    resolveSecondSnapshot([])
    await flushMicrotasks()

    expect(window.setTimeout).not.toHaveBeenCalled()
    expect(gatewayMocks.getPendingServerRequests).toHaveBeenCalledTimes(2)
  })

  it('waits for a pending turn/start before background cleanup', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-pending-turn' })
    let resolveTurnStart: (turnId: string) => void = () => {}
    gatewayMocks.startThreadTurn.mockImplementationOnce(() => new Promise((resolve) => {
      resolveTurnStart = resolve
    }))

    const state = useDesktopState()
    await state.openSideConversation('parent-thread')
    const sendPromise = state.sendSideConversationMessage('question')
    await Promise.resolve()
    state.endSideConversation()

    expect(state.isSideConversationOpen.value).toBe(false)
    expect(gatewayMocks.discardSideConversationThreadInBackground).not.toHaveBeenCalled()
    resolveTurnStart('side-turn-id')
    await sendPromise
    await flushMicrotasks()

    expect(gatewayMocks.discardSideConversationThreadInBackground).toHaveBeenCalledWith(
      'side-pending-turn',
      'side-turn-id',
    )
  })

  it('does not restore a closed side conversation in a new state instance', async () => {
    installTestWindow()
    gatewayMocks.startSideConversation.mockResolvedValue({ threadId: 'side-not-restored' })

    const state = useDesktopState()
    await state.openSideConversation('parent-thread')
    state.endSideConversation()
    await flushMicrotasks()

    const reloadedState = useDesktopState()
    reloadedState.primeSelectedThread('parent-thread')
    await reloadedState.restoreSideConversation()

    expect(reloadedState.isSideConversationOpen.value).toBe(false)
    expect(reloadedState.sideConversationThreadId.value).toBe('')
  })

  it('ignores late notifications from every discarded side thread', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.startSideConversation
      .mockResolvedValueOnce({ threadId: 'side-a' })
      .mockResolvedValueOnce({ threadId: 'side-b' })
      .mockResolvedValueOnce({ threadId: 'side-current' })

    const state = useDesktopState()
    state.startPolling()
    await state.openSideConversation('parent-thread')
    state.discardSideConversationInBackground()
    await state.openSideConversation('parent-thread')
    state.discardSideConversationInBackground()
    await state.openSideConversation('parent-thread')

    notificationHandler({
      method: 'error',
      params: { threadId: 'side-a', message: 'late side error' },
    })
    notificationHandler({
      method: 'server/request',
      params: {
        id: 41,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'side-b', turnId: 'turn-b', itemId: 'item-b' },
      },
    })
    state.primeSelectedThread('side-b')

    expect(state.error.value).toBe('')
    expect(state.sideConversationError.value).toBe('')
    expect(state.selectedThreadServerRequests.value).toEqual([])
    expect(gatewayMocks.replyToServerRequest).toHaveBeenCalledWith(41, {
      error: { code: -32000, message: 'Side conversation closed' },
    })
  })
})

describe('provider model selection', () => {
  it('ignores global selected-model localStorage when OpenCode Zen is the active provider', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread__': 'gpt-5.5',
      }),
      'codex-web-local.selected-model-id.v1': 'gpt-5.5',
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'big-pickle',
      providerId: 'opencode-zen',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenCalledWith(expect.objectContaining({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    }))
    expect(state.availableModelIds.value).toEqual([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])
    expect(state.selectedModelId.value).toBe('big-pickle')
    expect(state.readModelIdForThread('').trim()).toBe('big-pickle')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::__default__::opencode-zen': 'big-pickle',
    })
    expect(window.localStorage.getItem('codex-web-local.selected-model-id.v1')).toBe(null)
  })

  it('restores a valid provider-scoped OpenCode Zen selected model from localStorage', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::__default__::opencode-zen': 'ring-2.6-1t-free',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'big-pickle',
      providerId: 'opencode-zen',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.availableModelIds.value).toEqual([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])
    expect(state.selectedModelId.value).toBe('ring-2.6-1t-free')
    expect(state.readModelIdForThread('').trim()).toBe('ring-2.6-1t-free')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::__default__::opencode-zen': 'ring-2.6-1t-free',
    })
  })

  it('stores the new-thread Codex model in a provider-scoped slot', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::__default__::openrouter-free': 'openrouter/free',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue([
      'gpt-5.5',
      'gpt-5.4-mini',
    ])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.selectedModelId.value).toBe('gpt-5.5')
    expect(state.readModelIdForThread('').trim()).toBe('gpt-5.5')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::__default__::openrouter-free': 'openrouter/free',
      '__new-thread-provider__::__default__::codex': 'gpt-5.5',
    })
  })

  it('uses only the upstream visible catalog for a provider requiring OpenAI auth', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::__default__::codex-local-access': 'gpt-5.6-sol',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.6-sol',
      providerId: 'codex_local_access',
      upstreamCatalogProviderIds: ['codex_local_access'],
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.6', 'gpt-5.6-mini'])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenCalledWith(expect.objectContaining({
      includeProviderModels: false,
      requireProviderModels: false,
      providerId: undefined,
    }))
    expect(state.availableModelIds.value).toEqual(['gpt-5.6', 'gpt-5.6-mini'])
    expect(state.availableModelIds.value).not.toContain('gpt-5.6-sol')
    expect(state.selectedModelId.value).toBe('gpt-5.6')
  })

  it('restores new-chat model and Thinking defaults for the active account', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::account-a::codex': 'gpt-5.6',
      }),
      'codex-web-local.selected-reasoning-effort-by-context.v1': JSON.stringify({
        '__new-thread-provider__::account-a::codex': 'ultra',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5', 'gpt-5.6'])

    const state = useDesktopState()
    state.setActiveAccountStorageId('account-a')
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.selectedModelId.value).toBe('gpt-5.6')
    expect(state.selectedReasoningEffort.value).toBe('ultra')
    expect(state.readModelIdForThread('')).toBe('gpt-5.6')
  })

  it('does not apply a new-chat Thinking default to an existing thread', async () => {
    installTestWindow({
      'codex-web-local.selected-reasoning-effort-by-context.v1': JSON.stringify({
        '__new-thread-provider__::account-a::codex': 'ultra',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'high',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5'])
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: '',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('existing-thread-turn')

    const state = useDesktopState()
    state.setActiveAccountStorageId('account-a')
    state.primeSelectedThread('existing-thread')
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.selectedReasoningEffort.value).toBe('high')
    await state.sendMessageToSelectedThread('question')
    expect(gatewayMocks.startThreadTurn).toHaveBeenLastCalledWith(
      'existing-thread',
      'question',
      [],
      'gpt-5.5',
      'high',
      undefined,
      [],
      'default',
    )
  })

  it('updates the new-chat Thinking display when the active account changes', () => {
    installTestWindow({
      'codex-web-local.selected-reasoning-effort-by-context.v1': JSON.stringify({
        '__new-thread-provider__::account-a::codex': 'low',
        '__new-thread-provider__::account-b::codex': 'ultra',
      }),
    })

    const state = useDesktopState()
    state.setActiveAccountStorageId('account-a')
    expect(state.selectedReasoningEffort.value).toBe('low')
    state.setActiveAccountStorageId('account-b')

    expect(state.selectedReasoningEffort.value).toBe('ultra')
  })

  it('ignores a late model preference response from the previous account', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    type ModelConfig = { model: string, providerId: string, reasoningEffort: 'high', speedMode: 'standard' }
    let resolveAccountA: (config: ModelConfig) => void = () => {}
    gatewayMocks.getCurrentModelConfig
      .mockImplementationOnce(() => new Promise<ModelConfig>((resolve) => {
        resolveAccountA = resolve
      }))
      .mockResolvedValueOnce({
        model: 'gpt-5.6',
        providerId: '',
        reasoningEffort: 'high',
        speedMode: 'standard',
      })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.6'])

    const state = useDesktopState()
    state.setActiveAccountStorageId('account-a')
    const accountARefresh = state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    await flushMicrotasks()
    state.setActiveAccountStorageId('account-b')
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    resolveAccountA({
      model: 'gpt-5.4-mini',
      providerId: '',
      reasoningEffort: 'high',
      speedMode: 'standard',
    })
    await accountARefresh

    expect(state.selectedModelId.value).toBe('gpt-5.6')
    expect(state.readModelIdForThread('')).toBe('gpt-5.6')
  })

  it('keeps the Max reasoning effort reported for GPT-5.6', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.6',
      providerId: '',
      reasoningEffort: 'max',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.6'])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.selectedReasoningEffort.value).toBe('max')
  })

  it('keeps the selected Thinking value when the refreshed model catalog omits it', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.6',
      providerId: '',
      reasoningEffort: 'max',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockImplementation(async (options: {
      onModelCatalog?: (models: Array<{ id: string; supportedReasoningEfforts: string[] }>) => void
    }) => {
      options.onModelCatalog?.([
        { id: 'gpt-5.6', supportedReasoningEfforts: ['medium', 'high', 'xhigh', 'max', 'ultra'] },
        { id: 'gpt-5.5', supportedReasoningEfforts: ['medium', 'high', 'xhigh'] },
      ])
      return ['gpt-5.6', 'gpt-5.5']
    })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    state.setSelectedModelId('gpt-5.5')

    expect(state.selectedReasoningEffort.value).toBe('max')
    expect(state.availableModelReasoningEfforts.value['gpt-5.5']).toContain('max')
  })

  it('drops stale non-Codex selected models from the Codex model list', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::__default__::codex': 'big-pickle',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue([
      'gpt-5.5',
      'gpt-5.4-mini',
    ])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.availableModelIds.value).toEqual([
      'gpt-5.5',
      'gpt-5.4-mini',
    ])
    expect(state.availableModelIds.value).not.toContain('big-pickle')
    expect(state.selectedModelId.value).toBe('gpt-5.5')
    expect(state.readModelIdForThread('').trim()).toBe('gpt-5.5')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::__default__::codex': 'gpt-5.5',
    })
  })

  it('keeps an existing OpenCode Zen thread locked to Zen models after Codex auth becomes active', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('legacy-zen-thread', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.4-mini',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockImplementation(async (options?: { providerId?: string }) => {
      if (options?.providerId === 'opencode-zen') {
        return ['big-pickle', 'ring-2.6-1t-free']
      }
      return ['gpt-5.5', 'gpt-5.4-mini']
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.4-mini',
      modelProvider: 'opencode_zen',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })

    const state = useDesktopState()
    state.primeSelectedThread('legacy-zen-thread')
    await state.loadMessages('legacy-zen-thread')
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenLastCalledWith({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    })
    expect(state.availableModelIds.value).toEqual([
      'big-pickle',
      'ring-2.6-1t-free',
    ])
    expect(state.selectedModelId.value).toBe('big-pickle')
    expect(state.readModelIdForThread('legacy-zen-thread')).toBe('big-pickle')
    expect(state.readModelIdForThread('')).toBe('gpt-5.4-mini')
  })

  it('loads provider models for a selected provider-backed thread during scheduled refreshes', async () => {
    installTestWindow()
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        void Promise.resolve().then(() => callback())
      }
      return 1
    }) as typeof window.setTimeout)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('legacy-zen-thread', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.4-mini',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockImplementation(async (options?: { providerId?: string }) => {
      if (options?.providerId === 'opencode-zen') {
        return ['big-pickle', 'ring-2.6-1t-free']
      }
      return ['gpt-5.5', 'gpt-5.4-mini']
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.4-mini',
      modelProvider: 'opencode_zen',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })

    const state = useDesktopState()
    state.primeSelectedThread('legacy-zen-thread')
    await state.loadMessages('legacy-zen-thread')
    await state.refreshAll({ includeSelectedThreadMessages: false })
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenLastCalledWith({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    })
    expect(state.availableModelIds.value).toEqual(['big-pickle', 'ring-2.6-1t-free'])
    expect(state.selectedModelId.value).toBe('big-pickle')
  })

  it('captures the active provider when creating a new thread', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5', 'gpt-5.4-mini'])
    gatewayMocks.startThread.mockResolvedValue({
      threadId: 'codex-thread',
      model: 'gpt-5.5',
      modelProvider: 'openai',
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')
    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: 'openai',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          text: 'Hi.',
          messageType: 'agentMessage',
        },
      ],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    await state.sendMessageToNewThread('hi', '/tmp/project')

    expect(gatewayMocks.startThread).toHaveBeenCalledWith('/tmp/project', 'gpt-5.5')
    expect(gatewayMocks.startThreadTurn).toHaveBeenCalledWith(
      'codex-thread',
      'hi',
      [],
      'gpt-5.5',
      'medium',
      undefined,
      [],
      'default',
    )
    expect(state.readModelIdForThread('codex-thread')).toBe('gpt-5.5')
    expect(state.messages.value.some((message) => (
      message.role === 'user' &&
      message.text === 'hi' &&
      message.messageType === 'userMessage.optimistic'
    ))).toBe(true)

    const modelConfigCallsBeforeLoad = gatewayMocks.getCurrentModelConfig.mock.calls.length
    const availableModelCallsBeforeLoad = gatewayMocks.getAvailableModelIds.mock.calls.length
    await state.loadMessages('codex-thread')
    expect(gatewayMocks.getCurrentModelConfig).toHaveBeenCalledTimes(modelConfigCallsBeforeLoad)
    expect(gatewayMocks.getAvailableModelIds).toHaveBeenCalledTimes(availableModelCallsBeforeLoad)
    expect(state.messages.value.map((message) => `${message.role}:${message.text}`)).toEqual([
      'user:hi',
      'assistant:Hi.',
    ])
  })

  it('refreshes a loaded optimistic thread when completion events arrive', async () => {
    installTestWindow()
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        void Promise.resolve().then(() => callback())
      }
      return 1
    }) as typeof window.setTimeout)
    let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | undefined
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler as typeof notificationHandler
      return vi.fn()
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.4-mini',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5', 'gpt-5.4-mini'])
    gatewayMocks.startThread.mockResolvedValue({
      threadId: 'mini-thread',
      model: 'gpt-5.4-mini',
      modelProvider: 'openai',
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')
    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.4-mini',
      modelProvider: 'openai',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'hi',
          messageType: 'userMessage',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          text: 'Hi.',
          messageType: 'agentMessage',
        },
      ],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
    })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    await state.sendMessageToNewThread('hi', '/tmp/project')
    state.startPolling()
    expect(notificationHandler).toBeDefined()
    notificationHandler!({
      method: 'turn/completed',
      params: {
        threadId: 'mini-thread',
        turn: { id: 'turn-1', status: 'completed' },
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(gatewayMocks.getThreadDetail).toHaveBeenCalledWith('mini-thread')
    expect(state.messages.value.map((message) => `${message.role}:${message.text}`)).toEqual([
      'user:hi',
      'system:Worked for <1s',
      'assistant:Hi.',
    ])
  })

  it('surfaces selected thread load failures and still refreshes models', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5', 'gpt-5.4-mini'])
    gatewayMocks.resumeThread.mockRejectedValue(new Error('thread not found'))

    const state = useDesktopState()
    state.primeSelectedThread('missing-thread')
    await state.refreshAll({
      includeSelectedThreadMessages: true,
      awaitAncillaryRefreshes: true,
    })

    expect(state.selectedLiveOverlay.value?.errorText).toContain('thread not found')
    expect(state.availableModelIds.value).toEqual(['gpt-5.5', 'gpt-5.4-mini'])
    expect(state.selectedModelId.value).toBe('gpt-5.5')

    await state.ensureThreadMessagesLoaded('missing-thread', { silent: true })
    await state.loadMessages('missing-thread')
    expect(gatewayMocks.resumeThread).toHaveBeenCalledTimes(1)
  })
})

describe('findAdjacentThreadId', () => {
  it('selects the next thread after the archived thread', () => {
    const threads = [
      thread('first-thread', '/tmp/project'),
      thread('selected-thread', '/tmp/project'),
      thread('next-thread', '/tmp/project'),
    ]

    expect(findAdjacentThreadId(threads, 'selected-thread')).toBe('next-thread')
  })

  it('falls back to the previous thread when the last thread is archived', () => {
    const threads = [
      thread('previous-thread', '/tmp/project'),
      thread('selected-thread', '/tmp/project'),
    ]

    expect(findAdjacentThreadId(threads, 'selected-thread')).toBe('previous-thread')
  })

  it('returns no fallback when there is no adjacent thread', () => {
    expect(findAdjacentThreadId([thread('selected-thread', '/tmp/project')], 'selected-thread')).toBe('')
  })
})
