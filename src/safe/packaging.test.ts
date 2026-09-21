import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const itPosix = process.platform === 'win32' ? it.skip : it

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('local installation packaging', () => {
  it('defines clone-local install and service lifecycle scripts', async () => {
    const packageJson = JSON.parse(await readRepoFile('package.json')) as {
      private?: boolean
      scripts?: Record<string, string>
      bin?: Record<string, string>
      files?: string[]
    }
    expect(packageJson.private).toBe(true)
    expect(packageJson.scripts?.['install:local']).toBe('node scripts/install-local.cjs')
    expect(packageJson.scripts?.['service:install']).toBe('sh scripts/install-user-service.sh')
    expect(packageJson.scripts?.['service:restart']).toContain('systemctl --user restart')
    expect(packageJson.bin?.['codex-mobile']).toBe('dist-cli/index.js')
    expect(packageJson.bin?.['codex-mobile-safe']).toBe('dist-cli/safe.js')
    expect(packageJson.files).toContain('src/')
  })

  it('keeps plaintext passwords out of the restartable systemd unit', async () => {
    const unit = await readRepoFile('packaging/systemd/codex-mobile-safe.service.in')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('--sandbox-mode danger-full-access')
    expect(unit).toContain('--approval-policy never')
    expect(unit).toContain('--password-file %h/.codex/codex-mobile-safe-password')
    expect(unit).toContain('--no-open')
    expect(unit).not.toMatch(/--password(?:=|\s)/u)
    expect(unit).not.toContain('--lan')
    expect(unit).not.toContain('cloudflared')
    expect(unit).not.toContain('funnel')
  })

  itPosix('renders the installed safe unit and password through the isolated installer path', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-mobile-service-test-'))
    try {
      const homeDirectory = join(temporaryRoot, 'home')
      const configDirectory = join(temporaryRoot, 'config')
      const prefix = join(temporaryRoot, 'prefix')
      const binDirectory = join(temporaryRoot, 'bin')
      const commandLog = join(temporaryRoot, 'commands.log')
      await execFileAsync('mkdir', ['-p', binDirectory])

      const commandStub = '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$COMMAND_LOG"\nexit 0\n'
      const stubCommands = ['pnpm', 'npm', 'systemd-analyze', 'systemctl', 'loginctl']
      await Promise.all(stubCommands.map(async (command) => {
        const path = join(binDirectory, command)
        await writeFile(path, commandStub)
        await chmod(path, 0o755)
      }))

      await execFileAsync('sh', [fileURLToPath(new URL('../../scripts/install-user-service.sh', import.meta.url))], {
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          HOME: homeDirectory,
          XDG_CONFIG_HOME: configDirectory,
          PREFIX: prefix,
          CODEX_MOBILE_PREFIX: '',
          CODEX_MOBILE_SERVICE_INSTALL_TEST_MODE: '1',
          COMMAND_LOG: commandLog,
          USER: 'codex-mobile-test',
        },
      })

      const unitPath = join(configDirectory, 'systemd/user/codex-mobile-safe.service')
      const passwordPath = join(homeDirectory, '.codex/codex-mobile-safe-password')
      const unit = await readFile(unitPath, 'utf8')
      const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/u, '')
      const expectedExecStart = `ExecStart=${prefix}/bin/codex-mobile-safe start ${repoRoot} --port 5900 --password-file %h/.codex/codex-mobile-safe-password --no-open --no-login --sandbox-mode danger-full-access --approval-policy never`

      expect(unit).not.toMatch(/@[A-Z_]+@/u)
      expect(unit.split('\n')).toContain(expectedExecStart)
      expect(unit).toContain('--port 5900')
      expect(unit).toContain('--password-file %h/.codex/codex-mobile-safe-password')
      expect(unit).toContain('--sandbox-mode danger-full-access')
      expect(unit).toContain('--approval-policy never')
      expect(unit).toContain('UMask=0077')
      expect(unit).not.toMatch(/--password(?:=|\s)/u)
      expect(unit).not.toContain('--lan')
      expect(unit.toLowerCase()).not.toContain('cloudflared')
      expect(unit.toLowerCase()).not.toContain('funnel')
      expect((await stat(unitPath)).mode & 0o777).toBe(0o600)
      expect((await stat(passwordPath)).mode & 0o777).toBe(0o600)
      expect((await readFile(commandLog, 'utf8').catch(() => '')).trim()).toBe('')
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true })
    }
  })

  it('keeps platform-specific local installers behind one package command', async () => {
    const [localInstaller, windowsInstaller, installerDispatcher, serviceInstaller] = await Promise.all([
      readRepoFile('scripts/install-local.sh'),
      readRepoFile('scripts/install-local.bat'),
      readRepoFile('scripts/install-local.cjs'),
      readRepoFile('scripts/install-user-service.sh'),
    ])
    expect(localInstaller).toContain('pnpm run build')
    expect(localInstaller).toContain('npm install --global --prefix')
    expect(localInstaller).toContain('npm uninstall --global --prefix "$prefix" codex-mobile-safe')
    expect(localInstaller).toContain('legacy_mobile_bin="$prefix/bin/codex-mobile"')
    expect(localInstaller).toContain('rm -f "$legacy_mobile_bin"')
    expect(windowsInstaller).toContain('npm prefix --global')
    expect(windowsInstaller).toContain('call pnpm run build')
    expect(windowsInstaller).toContain('call npm install --global --prefix "%INSTALL_PREFIX%" "%ROOT%"')
    expect(windowsInstaller).toContain('Ensure %INSTALL_PREFIX% is in PATH.')
    expect(installerDispatcher).toContain("process.platform === 'win32'")
    expect(installerDispatcher).toContain("'install-local.bat'")
    expect(installerDispatcher).toContain("'install-local.sh'")
    expect(serviceInstaller).toContain('systemd-analyze --user verify')
    expect(serviceInstaller).toContain('loginctl show-user')
    expect(serviceInstaller).toContain('systemctl --user enable codex-mobile-safe.service')
    expect(serviceInstaller).toContain('systemctl --user restart codex-mobile-safe.service')
  })

  itPosix('honors the conventional PREFIX override for isolated installs', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-mobile-prefix-test-'))
    const binDirectory = join(temporaryRoot, 'bin')
    const capturePath = join(temporaryRoot, 'npm-args.txt')
    await execFileAsync('mkdir', ['-p', binDirectory])
    await writeFile(join(binDirectory, 'pnpm'), '#!/bin/sh\nexit 0\n')
    await writeFile(
      join(binDirectory, 'npm'),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n',
    )
    await Promise.all([
      chmod(join(binDirectory, 'pnpm'), 0o755),
      chmod(join(binDirectory, 'npm'), 0o755),
    ])

    await execFileAsync('sh', [fileURLToPath(new URL('../../scripts/install-local.sh', import.meta.url))], {
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        PREFIX: join(temporaryRoot, 'prefix'),
        CODEX_MOBILE_PREFIX: '',
        CAPTURE: capturePath,
      },
    })

    const npmArguments = (await readFile(capturePath, 'utf8')).trim().split('\n')
    expect(npmArguments.slice(0, 4)).toEqual([
      'install',
      '--global',
      '--prefix',
      join(temporaryRoot, 'prefix'),
    ])
  })
})
