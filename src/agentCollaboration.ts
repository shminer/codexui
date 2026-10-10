export type UiAgentCommunication = {
  id: string
  turnId: string
  tool: string
  senderThreadId: string
  receiverThreadIds: string[]
  prompt: string
  status: string
  agentsStates: Record<string, { status: string; message: string }>
}

export type UiSubagent = {
  threadId: string
  prompt: string
  status: string
  message: string
  messageSource?: 'activity' | 'summary'
  communications?: UiAgentCommunication[]
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function mergeSubagents(previous: UiSubagent[], incoming: UiSubagent[]): UiSubagent[] {
  const agents = new Map(previous.map((agent) => [agent.threadId, agent]))
  for (const agent of incoming) {
    const existing = agents.get(agent.threadId)
    const messageAgent = agent.message && (agent.messageSource !== 'activity' || !existing?.message)
      ? agent
      : existing?.message ? existing : agent
    agents.set(agent.threadId, {
      ...agent,
      prompt: existing?.prompt || agent.prompt,
      status: agent.status === 'unknown' ? existing?.status ?? agent.status : agent.status,
      message: messageAgent.message,
      messageSource: messageAgent.messageSource,
      communications: [...new Map([...(existing?.communications ?? []), ...(agent.communications ?? [])].map((event) => [event.id, event])).values()],
    })
  }
  return [...agents.values()]
}

export function collectSubagents(entries: Array<{ item: unknown; turnId: string }>, parentThreadId: string): UiSubagent[] {
  const agents = new Map<string, UiSubagent>()
  const communications = new Map<string, Map<string, UiAgentCommunication>>()
  const getAgent = (threadId: string): UiSubagent => {
    let agent = agents.get(threadId)
    if (!agent) {
      agent = { threadId, prompt: '', status: 'unknown', message: '' }
      agents.set(threadId, agent)
      communications.set(threadId, new Map())
    }
    return agent
  }
  for (const entry of entries) {
    const item = record(entry.item)
    if (item.type === 'subAgentActivity') {
      const threadId = text(item.agentThreadId)
      if (!threadId || threadId === parentThreadId) continue
      const kind = text(item.kind)
      const status = kind === 'started' || kind === 'resumed' ? 'running' : kind === 'interrupted' ? 'shutdown' : kind === 'completed' ? 'completed' : kind === 'failed' ? 'errored' : 'unknown'
      const agent = getAgent(threadId)
      if (status !== 'unknown') agent.status = status
      const agentPath = text(item.agentPath)
      if (!agent.message && agentPath) {
        agent.message = agentPath
        agent.messageSource = 'activity'
      }
      continue
    }
    if (item.type !== 'collabAgentToolCall' || !text(item.id)) continue
    const senderThreadId = text(item.senderThreadId)
    const receiverThreadIds = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.map(text).filter(Boolean) : []
    const agentsStates: UiAgentCommunication['agentsStates'] = {}
    for (const [id, value] of Object.entries(record(item.agentsStates))) {
      const state = record(value)
      agentsStates[id] = { status: text(state.status) || 'unknown', message: text(state.message) }
    }
    const communication: UiAgentCommunication = {
      id: text(item.id), turnId: entry.turnId, tool: text(item.tool), senderThreadId, receiverThreadIds,
      prompt: text(item.prompt), status: text(item.status), agentsStates,
    }
    const participants = [...new Set([senderThreadId, ...receiverThreadIds, ...Object.keys(agentsStates)])].filter((id) => id && id !== parentThreadId)
    for (const threadId of participants) {
      const agent = getAgent(threadId)
      if (!agent.prompt) agent.prompt = communication.prompt
      const state = agentsStates[threadId]
      if (state?.status && state.status !== 'unknown') agent.status = state.status
      else if (agent.status === 'unknown' && communication.tool === 'spawnAgent' && receiverThreadIds.includes(threadId)) agent.status = 'pendingInit'
      if (state?.message) {
        agent.message = state.message
        agent.messageSource = 'summary'
      }
      communications.get(threadId)!.set(communication.id, communication)
    }
  }
  return [...agents.values()].map((agent) => ({ ...agent, communications: [...communications.get(agent.threadId)!.values()] }))
}
