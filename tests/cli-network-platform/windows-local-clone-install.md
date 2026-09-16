# Feature: Windows local clone install

## Prerequisites / setup

- Windows with Node.js 18+ and pnpm installed.
- A PowerShell session whose `PATH` contains the npm global prefix reported by `npm prefix --global`.
- A clean clone of this repository with dependencies installed through `pnpm install`.

Set an isolated temporary installation prefix so the check cannot overwrite an existing global package:

```powershell
$prefix = Join-Path $env:TEMP 'codex-mobile-windows-install-test'
Remove-Item -LiteralPath $prefix -Recurse -Force -ErrorAction SilentlyContinue
$env:PREFIX = $prefix
```

## Actions

1. From the repository root, install the current clone:

   ```powershell
   pnpm run install:local
   ```

2. Run both generated Windows command shims directly from the temporary prefix:

   ```powershell
   & (Join-Path $prefix 'codex-mobile.cmd') --help
   & (Join-Path $prefix 'codex-mobile-safe.cmd') doctor
   ```

3. Confirm that the normal default prefix is discoverable for future installs:

   ```powershell
   Remove-Item Env:PREFIX
   npm prefix --global
   ```

## Expected results

- `pnpm run install:local` runs `scripts/install-local.bat`; it does not require `sh`, Git Bash, or WSL.
- The installation creates `codex-mobile.cmd` and `codex-mobile-safe.cmd` directly under the configured prefix.
- `codex-mobile --help` succeeds, and `codex-mobile-safe doctor` reports `codex-mobile-safe doctor: ok`.
- A normal install with no `PREFIX` override uses `npm prefix --global`, which must be on `PATH` for the commands to resolve by name.

## Rollback / cleanup

Remove the isolated installation and clear the override:

```powershell
Remove-Item -LiteralPath $prefix -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item Env:PREFIX -ErrorAction SilentlyContinue
```

The Linux-only `pnpm run service:*` commands are unchanged and must not be used as a Windows service installer.
