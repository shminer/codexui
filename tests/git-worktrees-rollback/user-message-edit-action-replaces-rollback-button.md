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

- Setup: a runtime without `thread/rollback`, then a fixture/runtime supporting it. Use only a disposable project with a known apply_patch edit.
- On the unsupported runtime, load the conversation: Edit is hidden. Calling the handler directly reports unsupported history editing without touching files or the draft.
- On the supported runtime, make rollback RPC fail: files and history remain intact. On success, verify history trims at the selected user turn, the captured patch is undone, and only then is the user text added to the draft.
- Simulate a file conflict after successful history rollback: the UI keeps the new history and explicitly lists file errors instead of reporting full success. Switching threads during the request must not append the old prompt to the new thread.
- Cleanup: archive the test thread and delete the disposable project.
- Performance: capability loads once per polling lifecycle, and is checked again only on explicit Edit. The server reads the session once before rollback, reuses that patch snapshot, and trims the returned history to the normal recent page. No retry loop or duplicated file undo.
