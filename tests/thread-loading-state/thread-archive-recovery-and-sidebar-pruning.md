### Thread archive recovery and sidebar pruning

#### Feature/Change Name
Deleting a thread recovers from Codex `no rollout found` archive failures and removes successfully archived threads from the sidebar immediately.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Codex CLI available on `PATH`
3. At least one normal thread and one newly-created thread that has not yet produced a rollout
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, create a new empty thread from the sidebar.
2. Open that thread's menu and choose `Archive thread`.
3. Confirm the thread disappears from the sidebar without a `no rollout found` error.
4. Rename another visible thread, then delete it.
5. Confirm the renamed thread disappears immediately and does not reappear after sidebar refresh/background pagination.
6. Call `thread/list` with `archived:false` through `/codex-api/rpc` and confirm the deleted thread ids are absent.
7. Call `thread/list` with `archived:true` and confirm the deleted thread ids are present.
8. Switch to dark theme and repeat steps 1-5.
9. Select `Archived` in the sidebar. Load additional pages if needed and locate the archived thread.
   Open its title and page through its read-only preview. Confirm no `thread/resume` or `thread/unarchive` is sent until Restore is clicked; close with Escape and confirm focus returns.
10. Restore it, confirm it disappears from this list without changing the open thread, then select `Active` and refresh.

#### Expected Results
- Empty or not-yet-materialized threads are archived after CodexUI sets a fallback name and retries.
- Already archived threads are treated as archived instead of surfacing a stale `no rollout found` error.
- The sidebar prunes archived ids from its accumulated paginated list before refreshing.
- Older unarchived threads may appear as the list refills, but archived threads do not remain visible.
- Behavior is consistent in light and dark themes.
- Archived threads have a paginated flat list; restoring persists after refresh and makes the thread visible in its original active project.
- Failed listing/restoration shows an error and allows retry; duplicate restore clicks do not issue duplicate requests.

#### Rollback/Cleanup
- Restore disposable archived threads or archive restored test threads as appropriate.
