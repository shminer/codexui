### Thread message cache skips unchanged refetches

#### Feature/Change Name
Loaded thread messages are reused when the thread list version has not changed and the thread is not in progress.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Browser dev tools Network panel open
3. An existing completed thread

#### Steps
1. Open the completed thread and wait for messages to render
2. Switch to another thread or home
3. Return to the same completed thread without new turn or thread update events
4. Inspect network/RPC calls during the return

#### Expected Results
- The first open loads messages normally
- Returning to the unchanged completed thread reuses cached messages
- No additional `thread/read` or `thread/resume` call is made for that unchanged return
- If the thread version changes or the thread is in progress, messages still refresh from the server

#### Rollback/Cleanup
- None

#### In-Flight Read Lifecycle Cancellation
- Setup: use the bridge lifecycle mock with a deferred `thread/read`, deferred initialization, and recorded business calls, initialization messages, page-cache entries, and maintenance timers. No real Codex process is required.
- Start the read, call `dispose()`, then resolve or reject the old response. Confirm the old read ends with a lifecycle error, does not retry or restart the process, does not refill the page cache, and leaves the maintenance timer stopped.
- Dispose during initialization, start a new explicit request, then settle the old initialization. Confirm the old request sends no business RPC or `initialized` message and does not clear the new initialization Promise. The new request succeeds normally.
- Change the mocked app-server configuration before a new request. Confirm the internally triggered disposal cancels old requests but does not cancel the new configuration's own request.
- In the same lifecycle, invalidate history with a rollback or a new retained snapshot. Confirm a stale read still follows the current snapshot rather than returning stale history.
- Cleanup: settle all deferred Promises, dispose the mock bridge, restore spies and timers, and retain the original conversation files.

---
