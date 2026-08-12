### Feature: Each message shows its local date and time

#### Prerequisites
- Open a thread containing user, assistant, command, and changed-files messages from different dates or times.

#### Steps
1. Inspect the timestamp below each visible message on desktop and at 375x812.
2. Send a new message and watch its timestamp while the response streams.
3. In a turn containing a delayed command and file edit, confirm their timestamps match the execution and edit times rather than the turn start time.
4. Refresh the thread, load an earlier page of messages, then simulate one failed thread read after a successful live-state read.
5. Repeat the checks in light and dark themes.

#### Expected Results
- Every persisted message displays its original date and time in the browser's local time zone.
- A newly sent or streaming message keeps a stable timestamp instead of changing during updates.
- Recovered command and changed-files messages retain their own execution timestamps.
- Refreshing or loading earlier messages preserves their original timestamps.
- A failed read that falls back to the last live-state snapshot preserves all message timestamps.
- Timestamps align with their message role and remain legible without overlapping content or controls.

#### Rollback/Cleanup
- No cleanup is required.
