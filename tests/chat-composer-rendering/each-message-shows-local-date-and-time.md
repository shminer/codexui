### Feature: Each message shows its local date and time

#### Prerequisites
- Open a thread containing user, assistant, command, and changed-files messages from different dates or times.

#### Steps
1. Inspect the timestamp below each visible message on desktop and at 375x812.
2. Send a new message and watch its timestamp while the response streams.
3. Refresh the thread and load an earlier page of messages.
4. Repeat the checks in light and dark themes.

#### Expected Results
- Every persisted message displays its original date and time in the browser's local time zone.
- A newly sent or streaming message keeps a stable timestamp instead of changing during updates.
- Refreshing or loading earlier messages preserves their original timestamps.
- Timestamps align with their message role and remain legible without overlapping content or controls.

#### Rollback/Cleanup
- No cleanup is required.
