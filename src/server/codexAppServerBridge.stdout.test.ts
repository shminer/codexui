import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppServerProcess } from './codexAppServerBridge'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: spawnMock,
}))

type ProcessInternals = {
  start(): void
  getCodexCommand(): { command: string }
  buildAppServerConfig(): { args: string[]; env: Record<string, string> }
  handleLine(line: string): void
}

const servers: AppServerProcess[] = []

function startMockProcess(server = new AppServerProcess()) {
  const proc = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: true,
    kill: vi.fn(),
  })
  spawnMock.mockReturnValue(proc)
  const internals = server as unknown as ProcessInternals
  vi.spyOn(internals, 'getCodexCommand').mockReturnValue({ command: process.execPath })
  vi.spyOn(internals, 'buildAppServerConfig').mockReturnValue({ args: [], env: {} })
  internals.start()
  if (!servers.includes(server)) servers.push(server)
  return { server, proc, internals }
}

afterEach(() => {
  servers.splice(0).forEach((server) => server.dispose())
  vi.restoreAllMocks()
})

describe('app-server stdout framing', () => {
  it('delivers a large fragmented JSON response once and preserves split UTF-8 and CRLF', () => {
    const { proc, internals } = startMockProcess()
    const onLine = vi.spyOn(internals, 'handleLine')
    const response = JSON.stringify({ id: 1, result: { text: 'x'.repeat(16 * 1024 * 1024) } })
    const unicodeResponse = JSON.stringify({ id: 2, result: { text: '\u4e2d\u6587' } })
    const bytes = Buffer.from(`${response}\r\n\n${unicodeResponse}\n`)

    for (let offset = 0; offset < bytes.length; offset += 4096) {
      proc.stdout.write(bytes.subarray(offset, offset + 4096))
    }

    expect(onLine.mock.calls.map(([line]) => line)).toEqual([response, unicodeResponse])
    const splitUtf8 = Buffer.from(`${unicodeResponse}\r\n`)
    for (const byte of splitUtf8) proc.stdout.write(Buffer.from([byte]))
    expect(onLine).toHaveBeenLastCalledWith(unicodeResponse)
  })

  it('drops incomplete frames on disposal and ignores output from the previous process', () => {
    const { server, proc, internals } = startMockProcess()
    const onLine = vi.spyOn(internals, 'handleLine')
    proc.stdout.write('{"id":1,"result":')
    server.dispose()
    const restarted = startMockProcess(server)
    proc.stdout.write('null}\n')
    restarted.proc.stdout.write('{"id":2,"result":null}\n')
    proc.emit('exit', 0)
    restarted.proc.stdout.write('{"id":3,"result":null}\n')

    expect(onLine.mock.calls.map(([line]) => line)).toEqual([
      '{"id":2,"result":null}',
      '{"id":3,"result":null}',
    ])
  })
})
