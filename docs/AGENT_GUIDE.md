# Agent Guide: codex-mobile and codex-mobile-safe

## Purpose

This repository maintains the upstream-compatible `codex-mobile` command and a hardened `codex-mobile-safe` module in one build. Keep shared UI and bridge behavior in the upstream paths; implement safety differences through explicit policy injection so upstream updates remain reviewable.

## Architecture

- `src/cli/index.ts`: upstream-compatible CLI entry point.
- `src/cli/safe.ts`: safe lifecycle CLI (`start`, `stop`, `status`, `urls`, `doctor`, login, and Tailscale exposure).
- `src/cli/shared/launcher.ts`: shared listener/browser startup helpers.
- `src/safe/runtimePolicy.ts`: safe host, port, sandbox, and approval defaults.
- `src/safe/featureGate.ts`: HTTP route and app-server RPC allowlists.
- `src/safe/pathPolicy.ts`: canonical allowed-root filesystem checks.
- `src/safe/passwordFile.ts`: password-file ownership, type, mode, and content validation.
- `src/safe/state.ts`: PID-validated managed process state.
- `src/safe/exposure.ts`: Tailscale Serve lifecycle; Funnel is rejected.
- `src/safe/doctor.ts`: static security-invariant diagnostics.
- `src/server/securityPolicy.ts`: policy interface injected into HTTP and app-server bridges.
- `packaging/systemd/`: template for the safe Linux user service.
- `scripts/install-local.cjs`: platform dispatcher for local installation.
- `scripts/install-local.sh` and `scripts/install-local.bat`: Unix and Windows local installers; `scripts/*user-service.sh` remains the Linux service lifecycle.

## Non-negotiable safe-mode invariants

1. Bind to `127.0.0.1` by default. The compatibility `--lan` override must remain explicit and must never be used by the Tailnet-only service.
2. Require authentication. A password file must be a regular file owned by the current user, contain a non-empty password, and grant no group/other permissions (mode `0600` or stricter).
3. Never start Cloudflare tunnels or Tailscale Funnel from safe mode. Remote access is opt-in Tailscale Serve only.
4. Do not treat a Tailscale source address as an authentication bypass.
5. Keep safe Codex defaults at `workspace-write` sandbox and `on-request` approvals.
6. Restrict HTTP features and app-server RPC methods through `featureGate.ts`; new methods or routes are denied until deliberately reviewed and allowlisted.
7. Canonicalize filesystem paths and keep them under the configured project root. Reject symlink escapes and missing paths.
8. Do not commit secrets, password files, runtime state, generated units, `.tgz` packages, or Tailnet credentials.

The original command may retain upstream behavior. Do not weaken safe mode to make both commands identical; move genuinely shared mechanics into `src/cli/shared` or the server layer and inject the policy difference.

## Development and verification

```bash
pnpm install
pnpm run test:unit
pnpm run build
```

Run the narrow test first while iterating, for example:

```bash
pnpm exec vitest run src/safe/exposure.test.ts
pnpm exec vitest run src/server/securityPolicy.test.ts
```

Before committing a runtime or packaging change, also run:

```bash
node dist-cli/index.js --help
node dist-cli/safe.js --help
node dist-cli/safe.js doctor
sh -n scripts/install-local.sh scripts/install-user-service.sh scripts/uninstall-user-service.sh
```

For an isolated local-install smoke test:

```bash
PREFIX=/tmp/codex-mobile-prefix sh scripts/install-local.sh
/tmp/codex-mobile-prefix/bin/codex-mobile --help
/tmp/codex-mobile-prefix/bin/codex-mobile-safe doctor
```

On Windows, use a temporary npm prefix and the generated command shims instead:

```powershell
$env:PREFIX = Join-Path $env:TEMP 'codex-mobile-prefix'
pnpm run install:local
& (Join-Path $env:PREFIX 'codex-mobile.cmd') --help
& (Join-Path $env:PREFIX 'codex-mobile-safe.cmd') doctor
Remove-Item Env:PREFIX
```

Instantiate the service template in a temporary location and run `systemd-analyze --user verify` before installing it. Follow the repository's CJS/closest-public-entry smoke-test rule and record the exact command and result in the PR.

## Change-to-test matrix

| Change | Required focused checks |
| --- | --- |
| Safe defaults or feature gates | `src/safe/runtimePolicy.test.ts`, `src/safe/featureGate.test.ts`, and doctor |
| HTTP/RPC policy | `src/server/securityPolicy.test.ts`, bridge security tests, and relevant route tests |
| Filesystem access | `src/safe/pathPolicy.test.ts` plus the affected HTTP route test |
| Password/state lifecycle | matching `src/safe/*test.ts`, stale PID and permissions cases |
| Tailscale exposure | `src/safe/exposure.test.ts`; confirm Serve only and no Funnel |
| CLI/build/package | launcher and safe entry tests, production build, both help commands, temporary-prefix install |
| systemd scripts/template | packaging test, `sh -n`, `systemd-analyze --user verify`, restart recovery |

Always finish with the complete test suite and production build. Update the relevant manual test document under `tests/` for behavior changes.

## Runtime operations

```bash
codex-mobile-safe start /path/to/project --password-file ~/.codex/codex-mobile-safe-password --no-open
codex-mobile-safe expose tailscale
codex-mobile-safe status
codex-mobile-safe urls
codex-mobile-safe unexpose
codex-mobile-safe stop
```

For the installed user service:

```bash
pnpm run service:install
pnpm run service:status
pnpm run service:restart
journalctl --user -u codex-mobile-safe -n 100
```

An HTTP 502 from a mobile RPC request means the HTTPS proxy received the request but could not obtain a valid response from the loopback backend. Check, in order: service state and journal, listener on `127.0.0.1:5900`, `codex-mobile-safe doctor`, `tailscale serve status`, then authentication. Do not solve a 502 by opening the listener to the LAN.

To remove the user service, run `pnpm run service:uninstall`. This removes the unit and managed state but intentionally leaves the password file for explicit user handling.

## Updating from upstream

Keep remotes named `origin` for `zonghang-li/codex-mobile` and `upstream` for `friuns2/codex-mobile`. Work on a feature branch:

```bash
git fetch origin upstream
git switch -c codex/<topic> origin/main
git rebase upstream/main
```

Resolve conflicts deliberately. In particular, preserve and revalidate:

- `src/safe/` and its tests;
- `src/server/securityPolicy.ts` and policy injection points;
- the `safe` build entry and package bin mapping;
- `packaging/systemd/` and installer scripts;
- this guide and the fork section of `README.md`.

After syncing, rerun focused security tests, the complete suite, production build, CLI smoke tests, temporary-prefix install, and service-template verification. Review bundle output for duplicated core chunks and record any startup or bundle-size regression.
