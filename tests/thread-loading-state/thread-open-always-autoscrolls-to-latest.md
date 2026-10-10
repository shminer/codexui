### Thread open always autoscrolls to latest

#### Feature/Change Name
Opening a thread always scrolls the conversation to the latest messages, with no per-thread scroll restore.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least one thread with enough messages to require scrolling
3. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open a thread and scroll to the middle of its history
2. Switch to another thread
3. Open the first thread again
4. Verify the viewport opens at the bottom (latest messages), not the previous middle position
5. Refresh the browser tab, open the same thread again, and verify it still opens at the bottom
6. Repeat steps 1 through 5 in dark theme
7. In a thread with more than 20 retained turns, page backward until the browser window omits the latest messages. Switch to another thread, then explicitly reopen the first while its latest response is delayed.
8. Verify one coalesced latest-page request restores the chronological snapshot before automatic following resumes. Release a wider snapshot containing turns 18, 19, 20 and 21 when only 20 and 21 were cached; verify rows remain 18, 19, 20, 21 before the retention budget selects the latest turns.
9. Repeat with a failed latest-page response; confirm the retained history remains readable and Retry/Jump to latest can recover without clearing the window.

#### Expected Results
- Opening a thread always lands on the latest messages
- Previously viewed scroll positions are not restored when revisiting a thread
- Browser refresh does not restore a previously viewed conversation scroll position
- Behavior is the same in light theme and dark theme
- Explicitly opening a cached history window awaits the shared latest loader before following. The state loader and component watcher do not duplicate that request.
- Failed latest restoration keeps the previous message window and reading position; an old response for another thread does not activate following or replace the selected thread.

#### Rollback/Cleanup
- None

---
