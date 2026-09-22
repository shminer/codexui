import { describe, expect, it } from 'vitest'
import { normalizeThreadGroupsV2, normalizeThreadMessagesV2, readThreadInProgressFromResponse } from './v2'
import type { ThreadListResponse, ThreadReadResponse } from '../appServerDtos'

function threadReadResponseWithContent(content: ThreadReadResponse['thread']['turns'][number]['items'][number][]): ThreadReadResponse {
  return {
    thread: {
      id: 'thread-1',
      preview: 'Use a skill',
      modelProvider: 'openai',
      createdAt: 1,
      updatedAt: 2,
      path: null,
      cwd: '/tmp/project',
      cliVersion: 'test',
      source: 'appServer',
      gitInfo: null,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        error: null,
        items: content,
      }],
    },
  }
}

describe('normalizeThreadGroupsV2', () => {
  it('shows a repeated thread id once while retaining distinct threads with the same title', () => {
    const first = threadReadResponseWithContent([]).thread
    const second = { ...first, id: 'thread-2' }
    const response: ThreadListResponse = { data: [first, first, second], nextCursor: null }

    expect(normalizeThreadGroupsV2(response)[0]?.threads.map((thread) => thread.id)).toEqual([
      'thread-1',
      'thread-2',
    ])
  })
})

describe('normalizeThreadMessagesV2', () => {
  it('preserves the message timestamp supplied by thread history', () => {
    const response = threadReadResponseWithContent([{
      type: 'agentMessage',
      id: 'agent-time',
      text: 'Timed response',
      createdAtIso: '2026-08-12T01:02:04.000Z',
    } as ThreadReadResponse['thread']['turns'][number]['items'][number]])

    expect(normalizeThreadMessagesV2(response)[0]?.createdAtIso).toBe('2026-08-12T01:02:04.000Z')
  })

  it('preserves selected skill inputs on the rendered user message', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-1',
      content: [
        { type: 'text', text: 'Use the browser skill', text_elements: [] },
        { type: 'skill', name: 'browser-use:browser', path: '/Users/igor/.codex/skills/browser/SKILL.md' },
      ],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-1',
      role: 'user',
      text: 'Use the browser skill',
      skills: [{ name: 'browser-use:browser', path: '/Users/igor/.codex/skills/browser/SKILL.md' }],
    })
  })

  it('renders skill-only user messages instead of dropping them as raw blocks', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-2',
      content: [
        { type: 'skill', name: 'composio-cli', path: '/Users/igor/.codex/skills/composio-cli/SKILL.md' },
      ],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-2',
      role: 'user',
      text: '',
      skills: [{ name: 'composio-cli', path: '/Users/igor/.codex/skills/composio-cli/SKILL.md' }],
    })
    expect(messages[0].isUnhandled).toBeUndefined()
  })

  it('decodes escaped heartbeat instructions without exposing raw XML', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'automation-user-1',
      content: [{
        type: 'text',
        text: `<heartbeat>
<automation_id>automation-1</automation_id>
<current_time_iso>2026-05-09T00:00:00.000Z</current_time_iso>
<instructions>
Reply with &lt;/instructions&gt; and A &amp; B
</instructions>
</heartbeat>`,
        text_elements: [],
      }],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'automation-user-1',
      role: 'user',
      text: 'Reply with </instructions> and A & B',
      isAutomationRun: true,
      automationDisplayName: 'automation-1',
    })
  })

  it('applies a base turn index for paged thread slices', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-3',
      content: [{ type: 'text', text: 'Paged message', text_elements: [] }],
    }]), 12)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-3',
      turnId: 'turn-1',
      turnIndex: 12,
    })
  })

  it('restores persisted reasoning from visible summaries without exposing raw content', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'reasoning',
      id: 'reasoning-1',
      summary: ['Checked the request.', 'Prepared the answer.'],
      content: ['hidden chain-of-thought must not be rendered'],
    }]))

    expect(messages).toEqual([expect.objectContaining({
      id: 'reasoning-1',
      role: 'assistant',
      text: 'Checked the request.\n\nPrepared the answer.',
      messageType: 'reasoning',
      turnId: 'turn-1',
      turnIndex: 0,
    })])
    expect(messages[0]?.text).not.toContain('hidden chain-of-thought')
  })

  it('renders failed turn errors as chat system messages', () => {
    const response = threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-4',
      content: [{ type: 'text', text: 'hi', text_elements: [] }],
    }])
    response.thread.turns[0].status = 'failed'
    response.thread.turns[0].error = {
      message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
      codexErrorInfo: null,
      additionalDetails: null,
    }

    const messages = normalizeThreadMessagesV2(response)

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      id: 'turn-1-error',
      role: 'system',
      text: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
      messageType: 'turnError',
      turnId: 'turn-1',
      turnIndex: 0,
    })
  })

  it('uses turn index fallback ids for failed turns with blank ids', () => {
    const response = threadReadResponseWithContent([])
    response.thread.turns = [
      {
        id: '',
        status: 'failed',
        error: {
          message: 'first failed turn',
          codexErrorInfo: null,
          additionalDetails: null,
        },
        items: [],
      },
      {
        id: '   ',
        status: 'failed',
        error: {
          message: 'second failed turn',
          codexErrorInfo: null,
          additionalDetails: null,
        },
        items: [],
      },
    ]

    const messages = normalizeThreadMessagesV2(response, 8)

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'turn-8-error',
        text: 'first failed turn',
        turnId: undefined,
        turnIndex: 8,
      }),
      expect.objectContaining({
        id: 'turn-9-error',
        text: 'second failed turn',
        turnId: undefined,
        turnIndex: 9,
      }),
    ])
  })
})

describe('readThreadInProgressFromResponse', () => {
  it('treats active thread status objects as in progress', () => {
    const response = threadReadResponseWithContent([])
    ;(response.thread as unknown as { status: { type: string } }).status = { type: 'active' }

    expect(readThreadInProgressFromResponse(response)).toBe(true)
  })
})
