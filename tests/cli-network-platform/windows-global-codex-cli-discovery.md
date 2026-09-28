### Feature: Windows PATH Codex CLI discovery

#### Prerequisites/Setup
1. Windows with Node.js 18+ and `@openai/codex` installed through npm.
2. A local clone installed with `pnpm run install:local`.

#### Steps
1. Confirm the environment can run the Codex command:

   ```powershell
   Get-Command codex
   codex --version
   ```

2. Start `codexapp` on a known local port:

   ```powershell
   codexapp --no-login --no-tunnel --no-open --port 5987
   ```

3. In a second PowerShell window, verify that the selected workspace roots remain readable and Codex returns models through the app bridge:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:5987/codex-api/workspace-roots-state
   Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"method":"model/list","params":{}}' http://127.0.0.1:5987/codex-api/rpc
   ```

4. Repeat with the installed `codex-mobile` command:

   ```powershell
   codex-mobile --no-login --no-tunnel --no-open
   ```

5. After the first RPC request, inspect the server process and its descendants with `Get-CimInstance Win32_Process`. Record the `node.exe`, `cmd.exe`, and `codex.exe` parent process IDs for the tested port.

6. Repeat with a temporary npm prefix that is present only in `PATH` (do not set `npm_config_prefix` or `PREFIX`):

   ```powershell
   $savedPath = $env:PATH
   $savedNpmPrefix = $env:npm_config_prefix
   $savedPrefix = $env:PREFIX
   Remove-Item Env:npm_config_prefix -ErrorAction SilentlyContinue
   Remove-Item Env:PREFIX -ErrorAction SilentlyContinue
   $env:PATH = "D:\npm-global;$savedPath"
   codexapp --no-login --no-tunnel --no-open --port 5988
   ```

#### Expected Results
- Both commands resolve the npm platform package's native `codex.exe` and start it directly.
- A custom prefix discovered only through its `PATH` shim also resolves the native platform executable.
- The CodexUI server owns `codex.exe` directly; there is no intermediate `cmd.exe` or `codex.js` Node process in that app-server chain.
- Direct native launches receive `CODEX_MANAGED_PACKAGE_ROOT` and exactly one matching `CODEX_MANAGED_BY_*` marker; inherited stale markers are removed. Explicit command overrides retain their caller-provided environment unchanged.
- Startup does not print `Codex CLI not found. Installing official Codex CLI from npm...` and does not issue a second npm install.
- `CODEXUI_CODEX_COMMAND` remains authoritative when explicitly set. If the native platform package cannot be resolved, the npm-generated `codex`/`codex.cmd` shim remains a working fallback.
- The roots response preserves the selected projects, and the `model/list` response contains a nonempty `data` array.

#### Rollback/Cleanup
- Stop each foreground server with `Ctrl+C`.
- Restore `$env:PATH`, `$env:npm_config_prefix`, and `$env:PREFIX` to their saved values if they were changed for the test.
