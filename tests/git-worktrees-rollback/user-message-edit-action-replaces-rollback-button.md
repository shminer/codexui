### User message edit action replaces rollback button

#### Feature/Change Name
The old rollback button is replaced with an `Edit message` action under each eligible user message, while keeping the existing behavior that appends the original text into the composer and rolls the thread back from that turn. The action stays hidden while the thread is generating so it cannot interrupt the active turn.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. An existing thread with at least one completed user/assistant turn
3. A prompt that keeps the assistant response active long enough to inspect the composer

#### Steps
1. Open a thread with multiple completed turns and start a new long response
2. While the response is generating, hover an earlier user message
3. Confirm `Edit message` is hidden and the empty composer shows an enabled stop button
4. Wait for the response to finish, then hover the same user message
5. Confirm `Edit message` appears and assistant responses no longer show the old `Rollback` button
6. Click `Edit message` on the earlier user message with recognizable text
7. Observe the composer draft after the click
8. Confirm the thread rolls back from the selected turn

#### Expected Results
- The action under eligible user messages is labeled `Edit message`
- The action is hidden during an active response, leaving the stop button available for that response
- Assistant responses no longer render the old rollback action
- Clicking `Edit message` appends the original user text into the composer
- The existing rollback behavior still truncates the selected turn and later turns

#### Rollback/Cleanup
- Re-send the edited message if you want to recreate the conversation path

---

### Capability and failure consistency

- Setup: a runtime without `thread/revert`, then Codex CLI 0.157.1 or a fixture/runtime supporting it. Use only a disposable project with a known apply_patch edit. A catalog containing only the removed `thread/rollback` method does not count as edit support.
- On the unsupported runtime, load the conversation: Edit is hidden. Calling the handler directly reports unsupported history editing without touching files or the draft.
- On the supported runtime, make `thread/revert` fail: files and history remain intact. On success, verify the request uses `{ threadId, beforeTurnId }`, history trims before the selected user turn, the captured patch is undone, and only then is the user text added to the draft.
- Revert a later turn in a multi-turn conversation: despite the native revert response containing empty `thread.turns`, the earlier messages remain visible after the follow-up `thread/read` and after refresh. Edit the first turn separately and confirm the empty history is handled normally.
- After an edit, load earlier messages and simulate a live-state read failure: removed turns must not return from cached history snapshots or pages.
- Make the retained-history read fail after a successful revert: the endpoint still succeeds, the known earlier turns remain visible, and the original user text is appended to the draft. The warning explicitly states that history was already reverted but could not be reloaded. Repeat with the first turn and confirm an empty history plus the restored draft.
- Combine the post-revert read failure with a file conflict: both warnings remain visible, the external file edit is preserved, and the draft is still restored.
- Simulate a file conflict after successful history rollback: the UI keeps the new history and explicitly lists file errors instead of reporting full success. Switching threads during the request must not append the old prompt to the new thread.
- Cleanup: archive the test thread and delete the disposable project.
- Performance: capability loads once per polling lifecycle, and is checked again only on explicit Edit. The edit endpoint makes exactly three sequential native calls (`thread/read`, `thread/revert`, `thread/read`), reads the session once before revert, reuses that patch snapshot, and trims the returned history to the normal recent page. The existing post-edit UI refresh is unchanged. No per-turn request fanout, retry loop, or duplicated file undo.

- Concurrent startup consumers share the in-flight method-catalog request. A later explicit Edit checks capabilities again, so a failed or stale startup read cannot authorize file changes.
