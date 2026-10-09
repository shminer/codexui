import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

describe('safe CLI entry packaging', () => {
  it('builds a dedicated safe entry and exposes both local commands', async () => {
    const [safeSource, tsupSource, packageSource] = await Promise.all([
      readFile(new URL('./safe.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../tsup.config.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ])
    const packageJson = JSON.parse(packageSource) as { bin?: Record<string, string> }
    expect(safeSource).toContain("command('start')")
    expect(safeSource).toContain(".option('--password-file <path>',")
    expect(safeSource).toContain('Codex sandbox mode: read-only, workspace-write, danger-full-access')
    expect(safeSource).toContain('Codex approval policy: untrusted, on-failure, on-request, never')
    expect(safeSource).toContain('parseSafeSandboxMode(options.sandboxMode)')
    expect(safeSource).toContain('parseSafeApprovalPolicy(options.approvalPolicy)')
    expect(safeSource).toContain('buildSafeSecurityPolicy')
    expect(safeSource).not.toContain('cloudflared')
    expect(tsupSource).toContain("'src/cli/safe.ts'")
    expect(packageJson.bin).toEqual({
      codexui: 'dist-cli/index.js',
      'codexui-safe': 'dist-cli/safe.js',
    })
  })

  describe('built CLI output', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))

    beforeAll(() => {
      execFileSync('pnpm', ['run', 'build:cli'], { cwd: root, stdio: 'pipe' })
    }, 30_000)

    it('renders the explicit unrestricted profile in actual start help', () => {
      const help = execFileSync(process.execPath, [fileURLToPath(new URL('../../dist-cli/safe.js', import.meta.url)), 'start', '--help'], {
        cwd: root,
        encoding: 'utf8',
      })
      const normalizedHelp = help.replace(/\s+/gu, ' ')
      expect(normalizedHelp).toContain('read-only, workspace-write, danger-full-access')
      expect(normalizedHelp).toContain('untrusted, on-failure, on-request, never')
    })

    it.each(['index', 'safe'])('reports the package version from %s without startup or runtime writes', async (entry) => {
      const temporaryHome = await mkdtemp(join(tmpdir(), 'codexui-version-'))
      try {
        const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
        const output = execFileSync(process.execPath, [join(root, 'dist-cli', `${entry}.js`), '--version'], {
          cwd: root,
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            PATH: '',
            CODEX_HOME: temporaryHome,
            CODEX_MOBILE_SAFE_HOME: temporaryHome,
          },
        })
        expect(output.trim()).toBe(packageJson.version)
        expect(await readdir(temporaryHome)).toEqual([])
      } finally {
        await rm(temporaryHome, { recursive: true, force: true })
      }
    })
  })
})
