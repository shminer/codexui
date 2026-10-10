### Feature: Deferred ancillary startup refreshes

#### Prerequisites
- App is running from this repository.
- At least one large existing thread is available in the sidebar.
- Browser runtime profiler can run with Playwright from this repository.
- Use request interception or network throttling to delay queue/title metadata and the initial thread body independently.

#### Steps
1. Open a large thread route directly, for example `#/thread/<thread-id>`.
2. Confirm the thread message history appears before non-critical metadata finishes refreshing.
3. Run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_ROUTE="#/thread/<thread-id>" PROFILE_WAIT_MS=7000 node scripts/profile-browser-runtime.cjs`.
4. Open the generated JSON report under `output/playwright/`.
5. Inspect `slowestApiRows` and `duplicateCounts`.
6. Reload with queue/title metadata delayed. Confirm the first thread-list page and the directly opened thread can appear without waiting for that metadata; let the requests finish and confirm queued messages and saved titles populate.
7. Delay thread A's initial body response, reload A, and select thread B after the list appears. Confirm B becomes selected and starts its own body request before A finishes. Release A and confirm B remains selected.
8. Reload the home route, delay provider status, allow the thread list to return, select B, then complete account loading. Confirm the temporary first list entry A does not trigger a body read from notification recovery. Finish provider status and confirm B loads normally.
9. Reject title metadata while allowing the list to succeed; separately reject queue metadata. Confirm the list remains usable. While titles are delayed, rename one thread and confirm the late title snapshot does not undo the rename.
10. After a title request fails with a network error or HTTP 503, refresh the list and allow title loading to succeed. Confirm saved titles recover. Force refresh with a nonempty title snapshot that omits a previously cached title; confirm the removed key no longer overrides the thread title.
11. Keep initial queue/title requests pending, refresh or switch an account to restart notifications, and allow the new metadata requests to finish before releasing the old responses. Confirm the new queue/title snapshots remain visible and old completions do not mark the new loaders as finished prematurely.

#### Expected Results
- A normal initial thread load with history included in the resume result uses one `thread/resume` and no fallback `thread/read`. Metadata-only resume results may use the existing bounded detail fallback.
- Direct thread route hydration has one owner and does not trigger duplicate selected-thread message loads from route watchers.
- Account loading, provider status, the first thread-list page, and direct-thread body hydration start concurrently. Body completion does not gate route synchronization.
- Persisted queue and title loading have independent, shared in-flight requests and do not block first-page thread-list rendering. Background queue snapshots retain the existing mutation-revision protection.
- Thread history loading is not blocked by waiting for `skills/list`, `account/rateLimits/read`, or `collaborationMode/list`.
- Skills, model metadata, rate limits, and collaboration modes still populate shortly after the thread is visible.
- Startup has one ancillary-refresh owner after provider status is known; quota watchers do not independently import auth during this phase. A confirmed imported account may trigger one necessary follow-up refresh.
- Returning a slow response for A does not select A again or block B. Notification recovery does not fetch the temporary first list entry when starting from home.
- Failed title reads are distinct from valid empty caches and can retry. Notification teardown invalidates old queue/title loaders; reconnect/account refresh can load current metadata again.
- The profiler report has no duplicate-load warnings.

#### Rollback/Cleanup
- Remove generated `output/playwright/browser-runtime-profile-*` artifacts if they are not needed for comparison evidence.
- Remove request interception/throttling and delete disposable test queues or restore renamed test titles.
