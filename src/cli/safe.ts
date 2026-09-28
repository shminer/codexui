import { createServer as createHttpServer } from 'node:http'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import {
  applyCodexCommandResolution,
  type CodexCommandResolution,
  getCodexSpawnEnv,
  resolveCodexCommandResolution,
} from '../commandResolution.js'
import { createServer as createApp } from '../server/httpServer.js'
import { generatePassword } from '../server/password.js'
import { buildSafeSecurityPolicy } from '../server/securityPolicy.js'
import { runDoctor } from '../safe/doctor.js'
import {
  assertPasswordProtectedExposure,
  exposeTailscale,
  unexposeTailscale,
} from '../safe/exposure.js'
import { readSecurePasswordFile } from '../safe/passwordFile.js'
import {
  loadSafeRuntimeConfig,
  parseSafeApprovalPolicy,
  parseSafeSandboxMode,
} from '../safe/runtimePolicy.js'
import {
  clearManagedState,
  getCurrentCommandMarker,
  readLiveManagedState,
  writeManagedState,
} from '../safe/state.js'
import { spawnSyncCommand } from '../utils/commandInvocation.js'
import { listenWithFallback, openBrowser } from './shared/launcher.js'

const program = new Command()
  .name('codex-mobile-safe')
  .description('Safe-by-default mobile browser interface for Codex app-server')

const __dirname = dirname(fileURLToPath(import.meta.url))

function getCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

async function readCliVersion(): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function requireCodexCommand(): CodexCommandResolution {
  const resolution = resolveCodexCommandResolution()
  if (!resolution) {
    throw new Error('Codex CLI is not installed. Install @openai/codex or run codex-mobile-safe login.')
  }
  return resolution
}

async function persistLaunchProject(projectPath: string): Promise<string> {
  const normalized = isAbsolute(projectPath) ? resolve(projectPath) : resolve(process.cwd(), projectPath)
  const info = await stat(normalized)
  if (!info.isDirectory()) throw new Error(`Not a directory: ${normalized}`)

  const statePath = join(getCodexHome(), '.codex-global-state.json')
  let state: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed as Record<string, unknown>
  } catch {}

  const normalizeRoots = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const roots = normalizeRoots(state['electron-saved-workspace-roots'])
  const activeRoots = normalizeRoots(state['active-workspace-roots'])
  state['electron-saved-workspace-roots'] = [normalized, ...roots.filter((root) => root !== normalized)]
  state['active-workspace-roots'] = [normalized, ...activeRoots.filter((root) => root !== normalized)]
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 })
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
  return normalized
}

async function persistGeneratedPassword(password: string): Promise<string> {
  const path = join(getCodexHome(), 'codex-mobile-safe-password')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${password}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

async function resolvePassword(options: {
  password: string | boolean
  passwordFile?: string
}): Promise<{ password?: string; generatedPath?: string }> {
  if (options.password === false) {
    if (options.passwordFile) throw new Error('--no-password cannot be combined with --password-file')
    return {}
  }
  if (typeof options.password === 'string') {
    if (options.passwordFile) throw new Error('--password and --password-file are mutually exclusive')
    return { password: options.password }
  }
  if (options.passwordFile) {
    return { password: await readSecurePasswordFile(resolve(options.passwordFile)) }
  }
  const password = generatePassword()
  return { password, generatedPath: await persistGeneratedPassword(password) }
}

program.command('start')
  .argument('[projectPath]', 'project directory to open on launch')
  .option('-p, --port <port>', 'port to listen on', '5900')
  .option('--password <pass>', 'set a specific password')
  .option('--password-file <path>', 'read the password from a mode-0600 file')
  .option('--no-password', 'disable password protection for local-only development')
  .option('--lan', 'bind to 0.0.0.0 for LAN access')
  .option('--open', 'open browser on startup', true)
  .option('--no-open', 'do not open browser on startup')
  .option('--login', 'check Codex authentication on startup', true)
  .option('--no-login', 'skip Codex authentication check')
  .option('--memories', 'enable Codex memories for spawned app-server processes', false)
  .option('--no-memories', 'disable Codex memories for spawned app-server processes')
  .option('--sandbox-mode <mode>', 'Codex sandbox mode: read-only, workspace-write, danger-full-access')
  .option('--approval-policy <policy>', 'Codex approval policy: untrusted, on-failure, on-request, never')
  .action(async (projectPath: string | undefined, options: {
    port: string
    password: string | boolean
    passwordFile?: string
    lan: boolean
    open: boolean
    login: boolean
    memories: boolean
    sandboxMode?: string
    approvalPolicy?: string
  }) => {
    const requestedPort = Number.parseInt(options.port, 10)
    if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
      throw new Error(`Invalid port: ${options.port}`)
    }
    const launchProject = await persistLaunchProject(projectPath?.trim() || process.cwd())
    const sandboxMode = parseSafeSandboxMode(options.sandboxMode)
    const approvalPolicy = parseSafeApprovalPolicy(options.approvalPolicy)
    const codexResolution = requireCodexCommand()
    applyCodexCommandResolution(codexResolution)
    process.env.CODEXUI_SANDBOX_MODE = sandboxMode
    process.env.CODEXUI_APPROVAL_POLICY = approvalPolicy
    process.env.CODEXUI_MEMORIES = options.memories ? 'true' : 'false'
    if (options.login && !(await stat(join(getCodexHome(), 'auth.json')).catch(() => null))) {
      console.warn('\nCodex is not logged in. Run `codex-mobile-safe login` before starting a chat.\n')
    }

    const envRoots = process.env.CODEX_MOBILE_SAFE_ALLOWED_ROOTS?.trim()
    const allowedRoots = [launchProject, ...(envRoots ? envRoots.split(delimiter) : [])].join(delimiter)
    const runtimeConfig = loadSafeRuntimeConfig({
      ...process.env,
      CODEX_MOBILE_SAFE_PORT: String(requestedPort),
      CODEX_MOBILE_SAFE_LAN: options.lan ? 'true' : 'false',
      CODEX_MOBILE_SAFE_SANDBOX_MODE: sandboxMode,
      CODEX_MOBILE_SAFE_APPROVAL_POLICY: approvalPolicy,
      CODEX_MOBILE_SAFE_ALLOWED_ROOTS: allowedRoots,
    })
    const passwordResolution = await resolvePassword(options)
    const { app, dispose, attachWebSocket } = createApp({
      password: passwordResolution.password,
      securityPolicy: buildSafeSecurityPolicy(runtimeConfig),
    })
    const server = createHttpServer(app)
    attachWebSocket(server)
    const listening = await listenWithFallback(server, requestedPort, runtimeConfig.bindHost)
    process.env.CODEXUI_SERVER_PORT = String(listening.port)

    const state = {
      pid: process.pid,
      port: listening.port,
      bindHost: runtimeConfig.bindHost,
      startedAt: new Date().toISOString(),
      accessMode: runtimeConfig.lanEnabled ? 'lan' as const : 'local' as const,
      externalExposure: 'disabled' as const,
      passwordProtected: Boolean(passwordResolution.password),
      commandMarker: getCurrentCommandMarker(),
    }
    await writeManagedState(state)

    const version = await readCliVersion()
    const lines = [
      '',
      'Codex Mobile Safe is running!',
      `  Version:  ${version}`,
      '  Repository: https://github.com/zonghang-li/codex-mobile',
      '',
      `  Bind:     http://${runtimeConfig.bindHost}:${String(listening.port)}`,
      `  Codex sandbox: ${sandboxMode}`,
      `  Approval policy: ${approvalPolicy}`,
      `  Local:    http://127.0.0.1:${String(listening.port)}`,
    ]
    if (passwordResolution.generatedPath) {
      lines.push(`  Generated password file: ${passwordResolution.generatedPath}`)
    }
    lines.push('')
    console.log(lines.join('\n'))
    if (options.open) openBrowser(`http://127.0.0.1:${String(listening.port)}`)

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      await clearManagedState().catch(() => {})
      await listening.close().catch(() => {})
      dispose()
    }
    process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)))
    process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)))
  })

program.command('status').description('Show managed server state').action(async () => {
  const state = await readLiveManagedState()
  console.log(JSON.stringify({ running: Boolean(state), state }, null, 2))
})

program.command('urls').description('Show browser URLs for the managed server').action(async () => {
  const state = await readLiveManagedState()
  const urls = state
    ? [`http://127.0.0.1:${String(state.port)}`, ...(state.tailscaleUrl ? [state.tailscaleUrl] : [])]
    : []
  console.log(JSON.stringify({ running: Boolean(state), urls }, null, 2))
})

const expose = program.command('expose').description('Enable an explicit authenticated exposure mode')
expose.command('tailscale').description('Expose the running service through Tailscale Serve').action(async () => {
  const state = await readLiveManagedState()
  if (!state) throw new Error('codex-mobile-safe is not running')
  assertPasswordProtectedExposure(state.passwordProtected)
  const tailscaleUrl = await exposeTailscale(state.port)
  await writeManagedState({ ...state, externalExposure: 'tailscale', tailscaleUrl })
  console.log(JSON.stringify({ ok: true, tailscaleUrl }, null, 2))
})

program.command('unexpose').description('Disable exposure created by codex-mobile-safe').action(async () => {
  const state = await readLiveManagedState()
  if (!state) throw new Error('codex-mobile-safe is not running')
  if (state.externalExposure === 'tailscale') await unexposeTailscale(state.port)
  await writeManagedState({ ...state, externalExposure: 'disabled', tailscaleUrl: undefined })
  console.log(JSON.stringify({ ok: true }, null, 2))
})

program.command('stop').description('Stop the managed server process').action(async () => {
  const state = await readLiveManagedState()
  if (!state) {
    console.log(JSON.stringify({ stopped: false, reason: 'not running' }, null, 2))
    return
  }
  process.kill(state.pid, 'SIGTERM')
  await clearManagedState()
  console.log(JSON.stringify({ stopped: true, pid: state.pid }, null, 2))
})

program.command('doctor').description('Run static safety checks for the packaged CLI').action(async () => {
  const root = resolve(__dirname, '..')
  const result = await runDoctor(root)
  console.log(result.ok ? 'codex-mobile-safe doctor: ok' : 'codex-mobile-safe doctor: failed')
  for (const failure of result.failures) console.log(`- ${failure}`)
  if (!result.ok) process.exitCode = 1
})

program.command('login').description('Run Codex login').action(() => {
  const resolution = resolveCodexCommandResolution() ?? { command: 'codex' }
  const result = spawnSyncCommand(resolution.command, ['login'], {
    stdio: 'inherit',
    env: getCodexSpawnEnv(resolution),
  })
  if (result.status !== 0) throw new Error(`Codex login failed with exit code ${String(result.status ?? -1)}`)
})

program.command('help').description('Show codex-mobile-safe command help').action(() => program.outputHelp())

program.parseAsync(process.argv).catch((error) => {
  console.error(`\nFailed to run codex-mobile-safe: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
