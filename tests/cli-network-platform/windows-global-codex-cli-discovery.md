### Feature: Windows PATH Codex CLI discovery

#### Prerequisites/Setup
1. Windows with Node.js 18+ and `codex.exe` exposed through `PATH`.
2. A local clone installed with `pnpm run install:local`.

#### Steps
1. Confirm the environment can run the Codex executable:

   ```powershell
   Get-Command codex.exe
   codex.exe --version
   ```

2. Start `codexapp` and stop it after startup output appears:

   ```powershell
   codexapp --no-login --no-tunnel --no-open
   ```

3. Repeat with the installed `codex-mobile` command:

   ```powershell
   codex-mobile --no-login --no-tunnel --no-open
   ```

#### Expected Results
- Both commands discover `codex.exe` directly through `PATH`.
- Startup does not print `Codex CLI not found. Installing official Codex CLI from npm...` and does not issue a second npm install.
- Commands continue to work when `codex.cmd` is the only PATH-based CLI shim.

#### Rollback/Cleanup
- Stop each foreground server with `Ctrl+C`.
- Restore the original `PATH` value if it was changed for the test.
