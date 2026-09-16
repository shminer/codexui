const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const isWindows = process.platform === 'win32'
const script = join(__dirname, isWindows ? 'install-local.bat' : 'install-local.sh')
const result = spawnSync(
  isWindows ? (process.env.ComSpec || 'cmd.exe') : 'sh',
  isWindows ? ['/d', '/s', '/c', `"${script}"`] : [script],
  { stdio: 'inherit', windowsVerbatimArguments: isWindows },
)

if (result.error) {
  console.error(`Failed to start local installer: ${result.error.message}`)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
