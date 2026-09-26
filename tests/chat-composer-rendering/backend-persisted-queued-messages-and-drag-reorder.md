### Backend-persisted queued messages and drag reorder

#### Feature/Change Name
Queued messages are saved through the backend, survive page refresh, and can be reordered by dragging a queued row before another queued row.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open a thread where a turn is actively running
3. Queue at least three messages while the turn is running
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, confirm each queued row has a drag handle at the start of the row
2. Refresh the page and reopen the same thread
3. Confirm all queued rows are still visible in the same order
4. Drag the third queued message onto the first queued message
5. Confirm the third message moves to the first position and the remaining queued messages keep their relative order
6. Refresh again and confirm the reordered queue order is preserved
7. Let the active turn finish and confirm the next sent queued message is the first reordered item
8. Queue at least two more messages, switch to dark theme, and repeat the drag reorder check

#### Expected Results
- Queued rows survive a page refresh because they are restored from backend state
- Dragging a queued row onto another queued row immediately reorders the queue
- The reordered queue order survives page refresh
- The reordered queue order controls which message sends next after the active turn finishes
- Edit, Steer, and Delete actions still operate on the correct queued row after reordering
- Drag handle, hover/drop target, and row text remain readable in both light theme and dark theme

#### Rollback/Cleanup
- Delete any queued test messages that should not be sent

---

### Concurrent browser queue edits

- Setup: open the same running thread in two browser tabs. Queue A and B, and wait for both tabs to show them.
- Delete A in the first tab, then B from the stale second tab. Add C in one tab while adding D in the other. Reorder a stale removed message and try to steer the same queued message from both tabs.
- Expected: deleted messages never reappear; C and D both survive. A missing drag target is a no-op. Only the client that atomically removes a message may steer it. Backend dequeues cannot be restored by a stale browser snapshot. Mutation errors are visible; refresh shows authoritative state.
- Close/reload a tab. Expected: persisted main queue remains available. Temporary side queues remain memory-only.
- Cleanup: remove the test queue messages from the current server state.
- Performance: each change sends one small ID operation, with serialized existing state-file updates. Only adds schedule a drain; removing/reordering does not scan or wake every queued thread. Pending reads cannot overwrite newer local edits.

### Queue model selection

- Setup: set global defaults to model A/medium and run the target thread with model B/high.
- Queue a message, finish the running turn, and inspect the next `turn/start` request.
- Expected: it uses the thread model B/high returned by `thread/resume` at execution time. Global defaults are used only if an older runtime omits the thread settings. This removes a redundant config request on current runtimes.
- Cleanup: remove remaining queued test messages.
