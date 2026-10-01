# Windows Local Paths And Linux Regression

## Setup

- Use Windows with Node and the existing dependencies installed. For the Linux checks, use a separate Linux checkout and dependency tree.
- Start the current checkout on `127.0.0.1:4173`. Use `pnpm run dev --host 127.0.0.1 --port 4173`; if the Windows wrapper reports `spawnSync ...vite.cmd EINVAL`, use `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173`.
- The automated browser check mocks Codex RPC and WebSocket responses. It creates temporary files and does not send a request to a model or change saved projects.

## Automated Actions

1. Run `pnpm exec vitest run src/pathUtils.test.ts src/server/httpServer.localFiles.test.ts src/server/skillsPaths.test.ts src/safe/pathPolicy.test.ts src/server/securityPolicy.test.ts`.
2. On Windows, run `node scripts/verify-local-paths.cjs` against the current dev server.
3. Inspect `output/playwright/local-paths-mock-results.json`. Every row must have `hrefOk`, `titleOk`, and `textOk` set to `true`.
4. Inspect the light and dark `output/playwright/testchat-*-paths-*-cjs.png` screenshots. They must show the actual TestChat conversation, readable links, and correctly themed surfaces.
5. Run the focused unit command again on Linux, then run `pnpm run test:unit`, `pnpm run build`, `node dist-cli/index.js --help`, and `node dist-cli/safe.js doctor` on each platform.

## Expected Results

- Drive paths with either separator, UNC shares, Windows device prefixes, `file:` URLs, relative paths, parent traversal within a root, home paths, line references, Chinese names, and literal `#`, `?`, and `%20` produce the correct URLs.
- HTTP(S) links retain their query strings and fragments.
- TestChat sends a unique marker through the mocked turn endpoint. The reply links remain correct after a refresh.
- The toolbar opens the actual temporary directory; its file links read the correct file. The chat Edit action opens that file's editor; saving writes to the same file. The image endpoint serves the original image bytes and the chat image decodes successfully.
- Selecting PathSkill in the composer and opening its chip reads exactly one `SKILL.md`, including when the RPC path uses Windows backslashes. Mock server and frontend skill lists group nested skills without losing drive or UNC roots.
- Directory navigation stops at the drive/share root. A Windows root listing survives an inaccessible entry's metadata. Linux root navigation, HTML relative assets, and Linux filenames containing question marks or backslashes still work.
- Safe mode rejects root escapes, symlink/junction escapes, and editing while the editing policy is disabled.
- Linux whitespace filenames: the HTTP check creates `report.txt` and `report.txt ` with distinct contents. The listing must retain `%20` in the second file's browse/edit links; opening and saving it must leave the plain sibling unchanged. A `folder ` directory must remain navigable, and safe-mode browsing must read the spaced target while editing stays disabled. These real-filesystem cases are skipped on Windows and cleaned up with the test fixture.
- The Linux TestChat mocks include `file:///tmp/report.txt%20`, `//home/alice/../notes.md`, and cwd `//home/alice` with `../notes.md`. The whitespace URL must retain `%20`; both parent references must resolve to `/home/notes.md`. Literal backslashes under a Linux double-slash cwd must remain filename characters. Windows UNC parent traversal must still stop at its share root; explicit `file://server/share/...` URLs retain UNC semantics even with a Linux cwd.
- UNC URL conversion is verified without depending on a network share. Opening an actual UNC share requires an available share and permissions and must be reported separately.

## Cleanup

- Both automated checks clean up their temporary filesystem fixtures. Browser contexts and mock sessions are closed at the end; screenshots and the JSON report remain under ignored `output/playwright/`.
- Leave the verification server on `4173` available. Do not restart or stop a persistent `5173` server.
