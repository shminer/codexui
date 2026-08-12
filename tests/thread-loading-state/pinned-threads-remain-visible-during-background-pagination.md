### Pinned threads remain visible during background pagination

#### Feature/Change Name
Pinned threads are no longer removed from the Pinned section while the sidebar is still loading older thread-list pages.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. More than 50 total unarchived threads exist
3. More than 40 older threads outside the initial recent page are pinned
4. Browser network throttling is available
5. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, reload the app.
2. Immediately open the sidebar Pinned section.
3. Confirm pinned rows from older history remain in the Pinned section after the initial thread list appears.
4. Throttle the pinned-thread summary requests so one 20-thread batch completes while the remaining batch is still loading, then wait through at least one 5-second pinned-state refresh.
5. Confirm the completed batch remains visible while later batches continue loading.
6. Wait for background thread pagination and pinned-summary loading to finish.
7. Confirm the same pinned rows remain visible and can still be selected.
8. Unpin one hydrated thread in another window, wait for state refresh, then confirm it leaves the Pinned section.
9. Simulate a pin-state request failure and delete an unpinned thread; confirm the normal archive still proceeds.
10. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- Saved pinned thread IDs are preserved while only the initial thread-list page is loaded.
- Missing pinned IDs are not pruned from the workspace-filtered thread list; only authoritative pin changes or explicit archive actions remove them.
- Each completed summary batch remains visible across the 5-second state refresh while later batches continue loading.
- An authoritative unpin removes its cached summary without affecting pins from other projects.
- Archiving an unpinned thread does not depend on a pin-state write; archiving a pinned thread still waits for unpin success.
- Pinned rows remain readable and selectable in both light and dark themes.

#### Rollback/Cleanup
- Unpin any disposable threads created only for this test.

---
