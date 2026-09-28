### Codex app-server memories default-off and opt-in

#### Feature/Change Name
Packaged CLI starts Codex app-server with memories disabled by default and supports explicit `--memories` opt-in.

#### Prerequisites/Setup
1. Build the CLI: `pnpm run build:cli`.
2. Use a temporary Codex home that does not already enable memories, for example `CODEX_HOME=$(mktemp -d)`.

#### Steps
1. Run the unit test: `pnpm exec vitest run src/server/appServerRuntimeConfig.test.ts`.
2. Start the packaged CLI in light theme with the temporary Codex home: `CODEX_HOME=<temp-home> node dist-cli/index.js --no-open --no-tunnel --no-login --no-password --port 5900`.
3. Trigger any route or action that starts the underlying Codex app-server.
4. Confirm the spawned app-server command includes `-c features.memories=false`, or confirm `codex features list` with equivalent config reports `memories` disabled.
5. Stop the temporary CLI process.
6. Start the packaged CLI with opt-in: `CODEX_HOME=<temp-home> node dist-cli/index.js --no-open --no-tunnel --no-login --no-password --memories --port 5900`.
7. Trigger any route or action that starts the underlying Codex app-server.
8. Confirm the spawned app-server command includes `-c features.memories=true`.
9. Open `http://127.0.0.1:5900/#/` and confirm the app shell still renders normally in light theme.
10. Switch to dark theme and confirm the app shell still renders normally.

#### Expected Results
- `buildAppServerArgs()` includes `-c features.memories=false`.
- `CODEXUI_MEMORIES=true` and `--memories` produce `-c features.memories=true`.
- `CODEXUI_MEMORIES=false` and `--no-memories` keep memories disabled.
- The packaged CLI no longer depends on the user's `~/.codex/config.toml` to disable memories for its spawned app-server.
- Light and dark themes are unchanged because this is a runtime launch/config change, not a UI surface change.

#### Rollback/Cleanup
- Stop the temporary packaged CLI process.
- Remove the temporary `CODEX_HOME`.

---
