# Feature: modular safe CLI local install and tailnet service

## Prerequisites / setup

- Linux with Node.js 18+, pnpm, curl, systemd user services, and Tailscale installed.
- The device is logged in to the intended tailnet and `${HOME}/.local/bin` is on `PATH`.
- A clean clone of `https://github.com/zonghang-li/codex-mobile.git`.
- One known existing thread created before the policy change. Record its id as `EXISTING_THREAD_ID`; its baseline `approvalPolicy` and `sandbox` will be captured before installing the new unit.

Set reusable values:

```bash
export SERVICE_URL='http://127.0.0.1:5900'
export EXISTING_THREAD_ID='<existing-thread-id>'
export THREAD_CWD="$PWD"
export COOKIE_JAR="$(mktemp)"
```

Authenticate to the currently installed service without putting its password in a command argument:

```bash
read -rsp 'Codex Mobile password: ' CODEX_MOBILE_PASSWORD; echo
export CODEX_MOBILE_PASSWORD
node -e 'process.stdout.write(JSON.stringify({password:process.env.CODEX_MOBILE_PASSWORD}))' | curl -fsS -c "$COOKIE_JAR" -H 'Host: codex-mobile.test' -H 'Content-Type: application/json' --data-binary @- "$SERVICE_URL/auth/login"
unset CODEX_MOBILE_PASSWORD
```

Capture the existing thread's pre-install policy through the supported RPC response:

```bash
node -e 'process.stdout.write(JSON.stringify({method:"thread/resume",params:{threadId:process.env.EXISTING_THREAD_ID}}))' | curl -fsS -b "$COOKIE_JAR" -H 'Host: codex-mobile.test' -H 'Content-Type: application/json' --data-binary @- "$SERVICE_URL/codex-api/rpc" > /tmp/codex-mobile-existing-before.json
node -e 'const r=require("/tmp/codex-mobile-existing-before.json").result; console.log(JSON.stringify({approvalPolicy:r.approvalPolicy,sandbox:r.sandbox},null,2))'
```

## Actions

1. Build and install the integrated clone, then replace the persistent unit:

   ```bash
   pnpm install
   pnpm run test:unit
   pnpm run build
   pnpm run install:local
   pnpm run service:install
   ```

2. Inspect the effective unit and service state:

   ```bash
   systemctl --user cat codex-mobile-safe.service
   systemctl --user show codex-mobile-safe.service -p ActiveState -p SubState -p MainPID -p ExecStart --no-pager
   ```

   Expect `ActiveState=active`, the safe entry point, `--port 5900`, `--password-file %h/.codex/codex-mobile-safe-password`, `--sandbox-mode danger-full-access`, and `--approval-policy never`. Expect no unresolved `@PROJECT_DIR@` or `@PREFIX@`.

3. Confirm loopback-only listening:

   ```bash
   ss -ltnp '( sport = :5900 )'
   ```

   Expect exactly a `127.0.0.1:5900` listener, never `0.0.0.0:5900`, `[::]:5900`, or another public address.

4. Verify password-file permissions and process arguments:

   ```bash
   stat -c '%a %U %n' "$HOME/.codex/codex-mobile-safe-password"
   SERVICE_PID="$(systemctl --user show codex-mobile-safe.service -p MainPID --value)"
   ps -ww -p "$SERVICE_PID" -o args=
   ps -ww -p "$SERVICE_PID" -o args= | grep -Eq -- '--password(=| )' && echo 'FAIL: plaintext password argument' || echo 'PASS: password-file only'
   ```

   Expect mode `600`, an argument containing only `--password-file`, and the final command to print `PASS: password-file only`.

5. Verify an unauthenticated login attempt is rejected with HTTP 401:

   ```bash
   curl -sS -o /tmp/codex-mobile-unauth-response.txt -w '%{http_code}\n' -H 'Host: codex-mobile.test' -H 'Content-Type: application/json' --data '{"password":"definitely-not-the-service-password"}' "$SERVICE_URL/auth/login"
   ```

   Expect exactly `401`. The synthetic non-local Host header deliberately bypasses the trusted-localhost shortcut so this exercises password authentication. Do not treat the unauthenticated HTML login page's GET status as the authorization assertion.

6. Confirm Tailnet-only exposure and absence of Funnel/Cloudflare:

   ```bash
   codex-mobile-safe expose tailscale
   codex-mobile-safe urls
   tailscale serve status
   tailscale funnel status
   pgrep -ax cloudflared || echo 'PASS: no cloudflared process'
   ```

   Expect Tailscale Serve to target `http://127.0.0.1:5900`, no Funnel configuration, and no `cloudflared` process. Confirm the HTTPS URL works only from an authenticated tailnet device and still shows the Codex Mobile password login.

7. Re-authenticate after the restart and create a new thread through the supported RPC. `thread/start` returns the effective policy:

   ```bash
   rm -f "$COOKIE_JAR"
   read -rsp 'Codex Mobile password: ' CODEX_MOBILE_PASSWORD; echo
   export CODEX_MOBILE_PASSWORD
   node -e 'process.stdout.write(JSON.stringify({password:process.env.CODEX_MOBILE_PASSWORD}))' | curl -fsS -c "$COOKIE_JAR" -H 'Host: codex-mobile.test' -H 'Content-Type: application/json' --data-binary @- "$SERVICE_URL/auth/login"
   unset CODEX_MOBILE_PASSWORD
   node -e 'process.stdout.write(JSON.stringify({method:"thread/start",params:{cwd:process.env.THREAD_CWD}}))' | curl -fsS -b "$COOKIE_JAR" -H 'Host: codex-mobile.test' -H 'Content-Type: application/json' --data-binary @- "$SERVICE_URL/codex-api/rpc" > /tmp/codex-mobile-new-thread.json
   node -e 'const r=require("/tmp/codex-mobile-new-thread.json").result; console.log(JSON.stringify({threadId:r.thread.id,approvalPolicy:r.approvalPolicy,sandbox:r.sandbox},null,2))'
   export NEW_THREAD_ID="$(node -e 'process.stdout.write(require("/tmp/codex-mobile-new-thread.json").result.thread.id)')"
   ```

   Expect `approvalPolicy` to be `never` and `sandbox.type` to be `dangerFullAccess`.

8. Open `NEW_THREAD_ID` in the mobile UI and send this exact prompt:

   ```text
   Run exactly this shell command, then report its exit status: marker=/tmp/codex-mobile-policy-check; printf 'ok\n' > "$marker" && test "$(cat "$marker")" = ok && rm "$marker"
   ```

   Expect execution without an approval prompt. Verify cleanup on the host:

   ```bash
   test ! -e /tmp/codex-mobile-policy-check && echo 'PASS: /tmp marker removed'
   ```

9. Resume the pre-existing thread after the new service install and compare its returned policy with the pre-install capture:

   ```bash
   node -e 'process.stdout.write(JSON.stringify({method:"thread/resume",params:{threadId:process.env.EXISTING_THREAD_ID}}))' | curl -fsS -b "$COOKIE_JAR" -H 'Host: codex-mobile.test' -H 'Content-Type: application/json' --data-binary @- "$SERVICE_URL/codex-api/rpc" > /tmp/codex-mobile-existing-after.json
   node -e 'for(const f of ["before","after"]){const r=require(`/tmp/codex-mobile-existing-${f}.json`).result; console.log(f,JSON.stringify({approvalPolicy:r.approvalPolicy,sandbox:r.sandbox}))}'
   ```

   Expect the before/after policy objects to match exactly; the service profile applies only to newly created mobile threads.

10. Verify restart recovery:

    ```bash
    OLD_PID="$(systemctl --user show codex-mobile-safe.service -p MainPID --value)"
    kill "$OLD_PID"
    sleep 4
    systemctl --user show codex-mobile-safe.service -p ActiveState -p MainPID --no-pager
    ```

    Expect `ActiveState=active` and a different nonzero `MainPID`; repeat a `thread/read` or UI open for `NEW_THREAD_ID`.

## Expected results

- The rendered installed unit has no placeholders and contains the complete safe ExecStart with port 5900, password-file, `danger-full-access`, and `never`.
- Password mode remains `0600`; plaintext password, `--lan`, public bind, Cloudflare Tunnel, and Tailscale Funnel remain absent.
- Unauthenticated login is rejected with 401; Tailnet access still requires both tailnet membership and Codex Mobile authentication.
- Only a newly created mobile thread reports the unrestricted/no-approval profile and completes the harmless `/tmp` write/remove without approval.
- The existing thread's `thread/resume` policy matches its pre-install capture.
- Restart recovery preserves the loopback/password/Tailnet protections.

## Persistent rollback / cleanup

Restore the restricted policy in the repository template so future installs do not reintroduce the mobile override, commit or otherwise preserve that repository change, then reinstall the unit:

```bash
sed -i 's/--sandbox-mode danger-full-access --approval-policy never/--sandbox-mode workspace-write --approval-policy on-request/' packaging/systemd/codex-mobile-safe.service.in
git diff --check
git add packaging/systemd/codex-mobile-safe.service.in
git commit -m 'revert: restore restricted mobile service policy'
pnpm run install:local
pnpm run service:install
systemctl --user daemon-reload
systemctl --user restart codex-mobile-safe.service
systemctl --user cat codex-mobile-safe.service
systemctl --user show codex-mobile-safe.service -p ActiveState -p ExecStart --no-pager
```

Expect the effective ExecStart to contain `--sandbox-mode workspace-write --approval-policy on-request`. Create another new thread and repeat the `thread/start` response check; expect `approvalPolicy: on-request` and `sandbox.type: workspaceWrite`. Existing threads remain unchanged.

Finally remove temporary evidence and exposure. Uninstall only if the persistent service is no longer required:

```bash
codex-mobile-safe unexpose
rm -f "$COOKIE_JAR" /tmp/codex-mobile-existing-before.json /tmp/codex-mobile-existing-after.json /tmp/codex-mobile-new-thread.json /tmp/codex-mobile-unauth-response.txt
pnpm run service:uninstall
```

The password file is intentionally retained; delete it only when the user explicitly wants to discard that credential.

### Safe authentication and Git policy regression

- Setup: a safe server with a password file, an allowed temporary project root, and file editing disabled. Keep a second temporary directory outside that root.
- Request Git review summary/snapshot and Git branch/status for the outside directory; attempt review actions, git/init, checkout and reset there. Expected: HTTP 403, no files changed. Writes within the root also return 403 while file editing is disabled.
- Enable file editing explicitly and repeat: init inside the root succeeds; outside requests remain 403. An allowed subfolder must not grant access to its parent Git repository.
- Connect directly from a Tailscale address without a session cookie: safe mode requires login. A valid login session works. The ordinary entry keeps its existing Tailscale behavior.
- Cleanup: stop only the test server and remove its temporary directories/password file.
- Performance: default ordinary mode adds no Git subprocess. Safe mode checks canonical cwd and Git root, and checks Git metadata for writes; each request has a fixed number of checks and no retry loop.

- With file editing enabled, request checkout of a branch occupied by a worktree outside the allowed roots. Expected: 403 and the outside worktree keeps its branch; automatic detach recovery also enforces canonical allowed roots. This adds one path check only on the occupied-branch recovery path.
