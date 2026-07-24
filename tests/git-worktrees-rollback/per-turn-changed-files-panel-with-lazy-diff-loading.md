### Feature: Per-turn changed files panel with lazy diff loading

#### Prerequisites
- App server running from this repository.
- Worktree git automation enabled.
- A thread with at least one completed turn that touched files.

#### Steps
1. Open a thread and locate a `Worked for ...` separator message.
2. Expand the worked separator.
3. Verify a changed-files panel appears above command details.
4. Confirm file list entries show file path and `+/-` counts.
5. Click one changed file row to expand it.
6. Verify diff content loads only after expansion (lazy load behavior).
7. Collapse and re-expand the same file row; verify diff reuses loaded content.
8. Switch to another thread and back; verify panel reloads for the active thread context.
9. At a 375px-wide mobile viewport, expand a `x files changed · x edited` summary in either a completed file-change message or an assistant message.
10. Tap the visible `X` on the expanded summary row.
11. At a 341px-wide mobile viewport, open one changed file into the full Diff viewer.
12. Confirm the `X` remains visible at the top right, then tap it.
13. Switch to the dark theme and repeat steps 11 through 12.
14. Confirm the app header, terminal control, and branch control remain behind the Diff viewer while it is open.

#### Expected Results
- Each worked message can show changed files for its turn.
- Diff for a file is fetched only on expand, not for all files upfront.
- Errors (missing commit/diff load failure) are shown inline in the panel.
- Existing command output expand/collapse behavior remains unchanged.
- Changed-files panel still resolves after page refresh or app-server restart.
- Changed-files panel appears at the end of the worked message block (after command rows).
- The mobile expanded summary row displays a tappable `X` and collapses its file list without navigating away from the conversation.
- The full mobile Diff viewer keeps a tappable top-right `X` at 341px width and closes without relying on its toolbar layout.
- The app header cannot cover the Diff toolbar or its close control.
- The same close control remains visible and readable in the dark theme.

#### Rollback/Cleanup
- No cleanup required.
