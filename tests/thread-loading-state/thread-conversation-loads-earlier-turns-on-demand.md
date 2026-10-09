### Thread conversation loads earlier turns on demand

#### Feature/Change Name
Thread conversation incremental older-turn loading.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. A thread with more than 10 turns is available
3. Light theme and dark theme both available from the appearance switcher
4. For the oversized-turn case, a saved thread with at least 50 turns and one middle turn exceeding the 2 MiB estimated text budget

#### Steps
1. In light theme, open a thread that has more than 10 turns.
2. Confirm the newest messages render first and the conversation shows the Load earlier messages control at the top.
3. Click Load earlier messages once.
4. Confirm an older batch is prepended above the previously first visible turn and the scroll position stays near the same content.
5. Continue clicking Load earlier messages until the control disappears.
6. Confirm the oldest messages in the thread are visible and no duplicate message rows are introduced.
7. Switch to dark theme and repeat steps 1-6 on the same thread or another long thread.
8. Continue through enough pages to exceed 20 turns. Confirm the distant newer end is unloaded and a newer-history control is available.
9. Load newer history repeatedly. Confirm no gaps or duplicate messages, and verify turn actions still refer to the original turn IDs.
10. Read older history while the thread receives new output. Confirm silent refreshes do not replace the reading window with the newest messages.
11. Click Jump to latest. Confirm a successful request replaces the reading window; simulate a failure and confirm the old content remains visible.
12. Repeat historical navigation in an archived-thread preview and an agent-detail panel. Confirm they use the same bounded behavior.
13. In the oversized-turn thread, navigate from the latest window to the oldest window and then back to the latest. Record the visible turn IDs on each step. Confirm the oversized turn appears intact in both directions, occupies its own ordinary window, and allows continued navigation on either side.
14. Load a final newer page containing an oversized middle turn. If the page is only partly displayed, confirm the newer-history control stays available. Allow a background refresh, confirm it preserves the reading window, and load the remaining newer history.
15. Repeat steps 13-14 in the archived-thread preview and agent-detail panel, including a page containing raw turns with no displayable messages. Confirm each click advances the raw cursor rather than repeatedly requesting the same empty page.

#### Expected Results
- Initial thread open remains bounded to the latest turn page.
- Load earlier messages fetches older persisted turns from the local bridge instead of only revealing already-loaded messages.
- The control remains available while older persisted turns exist and disappears after the first turn is loaded.
- Message ordering, turn actions, and scroll restoration remain stable in light and dark themes.
- The active ordinary window retains at most 20 complete turns with a 2 MiB estimated text target. One oversized turn and protected unpersisted/approval content may exceed the target.
- Non-active ordinary body caches are limited to the three most recently used threads, each up to 10 turns and 512 KiB. Metadata, unread state and pending work are independent of body eviction.
- A stale turn anchor returns an explicit error rather than falsely indicating the end of history. Retrying preserves the selected paging direction.
- Paging starts with the incoming turn nearest the current cursor. A large middle turn is never skipped to fill the window with smaller turns farther away.
- The newer-history control and reading mode remain active while budget trimming leaves undisplayed turns, even when the server page reports no later page.

#### Rollback/Cleanup
- Closing the preview or switching threads releases disposable body caches; reopening reloads saved history. No source conversation is removed.

---
