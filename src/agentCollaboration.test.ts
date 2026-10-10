import { describe, expect, it } from 'vitest'
import { collectSubagents, mergeSubagents } from './agentCollaboration'

const spawn = { type: 'collabAgentToolCall', id: 'spawn', tool: 'spawnAgent', senderThreadId: 'parent', receiverThreadIds: ['a'], prompt: 'Task A', status: 'inProgress', agentsStates: { a: { status: 'running', message: null } } }
const completed = { ...spawn, status: 'completed', agentsStates: { a: { status: 'completed', message: 'Result A' } } }

describe('agent collaboration history', () => {
  it('merges started/completed snapshots by event ID and retains terminal agents', () => {
    const started = collectSubagents([{ item: spawn, turnId: 'turn' }], 'parent')
    const done = collectSubagents([{ item: completed, turnId: 'turn' }], 'parent')
    const merged = mergeSubagents(started, done)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ threadId: 'a', status: 'completed', prompt: 'Task A', message: 'Result A' })
    expect(merged[0]?.communications).toHaveLength(1)
    expect(merged[0]?.communications?.[0]?.status).toBe('completed')
    expect(collectSubagents([{ item: spawn, turnId: 'turn' }, { item: completed, turnId: 'turn' }], 'parent')).toEqual(merged)
  })

  it('includes agent-to-agent senders and receivers without treating the parent as a child', () => {
    const agents = collectSubagents([
      { turnId: 'turn-1', item: spawn },
      { turnId: 'turn-2', item: { ...spawn, id: 'message', tool: 'sendMessage', senderThreadId: 'a', receiverThreadIds: ['b', 'parent'], prompt: 'Review this' } },
    ], 'parent')
    expect(agents.map((agent) => agent.threadId)).toEqual(['a', 'b'])
    expect(agents[0]?.communications?.map((event) => event.id)).toEqual(['spawn', 'message'])
    expect(agents[1]?.communications?.[0]).toMatchObject({ senderThreadId: 'a', receiverThreadIds: ['b', 'parent'], turnId: 'turn-2' })
    expect(agents[0]?.prompt).toBe('Task A')
    const listed = collectSubagents([{ turnId: 'turn', item: { ...completed, id: 'list', tool: 'listAgents', receiverThreadIds: [] } }], 'parent')
    expect(listed[0]).toMatchObject({ threadId: 'a', status: 'completed' })
  })

  it('preserves newer status across older pages and ignores unknown activity statuses', () => {
    const latest = collectSubagents([{ item: completed, turnId: 'new' }], 'parent')
    const older = collectSubagents([{ item: spawn, turnId: 'old' }], 'parent')
    expect(mergeSubagents(older, latest)[0]?.status).toBe('completed')
    const unknown = collectSubagents([
      { item: { type: 'subAgentActivity', agentThreadId: 'a', kind: 'unknown' }, turnId: 'turn' },
      { item: { type: 'subAgentActivity', agentThreadId: 'parent', kind: 'started' }, turnId: 'turn' },
    ], 'parent')
    expect(mergeSubagents(latest, unknown)[0]?.status).toBe('completed')
    expect(unknown.map((agent) => agent.threadId)).toEqual(['a'])
  })

  it('accepts a newer summary without communications and keeps its source with the selected body', () => {
    const previous = [{ threadId: 'a', prompt: 'Task A', status: 'running', message: '/root/a', messageSource: 'activity' as const }]
    const incoming = [{ threadId: 'a', prompt: '', status: 'completed', message: 'Gateway checked' }]
    expect(mergeSubagents(previous, incoming)[0]).toMatchObject({ message: 'Gateway checked', messageSource: undefined, prompt: 'Task A' })
    const activity = [{ ...previous[0]!, message: '/root/new-path', status: 'unknown' }]
    expect(mergeSubagents(incoming, activity)[0]).toMatchObject({ message: 'Gateway checked', messageSource: undefined, status: 'completed' })
  })

  it('retains summaries across activity and empty messages while preserving missing agents', () => {
    const previous = collectSubagents([{ item: completed, turnId: 'new' }], 'parent')
    const activity = collectSubagents([{ item: { type: 'subAgentActivity', agentThreadId: 'a', kind: 'interacted', agentPath: '/root/a' }, turnId: 'new' }], 'parent')
    expect(mergeSubagents(previous, activity)[0]).toMatchObject({ message: 'Result A', messageSource: 'summary', status: 'completed' })
    expect(mergeSubagents(previous, [{ threadId: 'a', prompt: '', status: 'unknown', message: '' }])[0]).toMatchObject({ message: 'Result A', messageSource: 'summary' })
    expect(mergeSubagents(previous, [])).toEqual(previous)
    expect(mergeSubagents([{ threadId: 'a', prompt: '', status: 'unknown', message: '' }], activity)[0]).toMatchObject({ message: '/root/a', messageSource: 'activity' })
  })

  it('keeps summaries regardless of activity order and only initializes explicit spawn receivers', () => {
    const activity = { item: { type: 'subAgentActivity', agentThreadId: 'a', kind: 'interacted', agentPath: '/root/a' }, turnId: 'turn' }
    const summary = { item: completed, turnId: 'turn' }
    for (const entries of [[activity, summary, activity], [summary, activity]]) {
      expect(collectSubagents(entries, 'parent')[0]).toMatchObject({ message: 'Result A', messageSource: 'summary', status: 'completed' })
    }
    const unknownActivity = collectSubagents([activity], 'parent')
    expect(unknownActivity[0]).toMatchObject({ status: 'unknown', messageSource: 'activity' })
    expect(collectSubagents([{ item: { ...spawn, agentsStates: {} }, turnId: 'turn' }], 'parent')[0]?.status).toBe('pendingInit')
    expect(collectSubagents([{ item: { ...spawn, tool: 'sendMessage', agentsStates: {} }, turnId: 'turn' }], 'parent')[0]?.status).toBe('unknown')
    expect(collectSubagents([{ item: { ...activity.item, agentPath: '' }, turnId: 'turn' }], 'parent')[0]?.messageSource).toBeUndefined()
  })
})
