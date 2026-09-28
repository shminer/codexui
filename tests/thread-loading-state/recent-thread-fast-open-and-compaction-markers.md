### Feature: Recent thread fast open and context compaction markers

#### Prerequisites
- Run the app with a local Codex home containing a thread longer than 10 turns and at least one completed context compaction.
- Keep a second short thread available for switching.
- For the duplicate-rollout regression, keep two `thread/list` rows with the same thread ID and different paths/`updatedAt` values. The newer filename may append another rollout ID after the thread ID.

#### Steps
1. Open the long thread with the Network panel visible. Inspect `GET /codex-api/thread-recent?threadId=...` and the subsequent `thread/resume` RPC.
2. Before the resume finishes, confirm the latest messages appear. Then wait for it to finish and check that messages are not duplicated or reordered.
3. Scroll to the top or press **Load earlier messages** repeatedly until the beginning of the thread. Inspect the earlier page requests and scroll position.
4. Find a completed context compaction in the timeline. Compare its time with the local rollout's `compacted` event. During a new compaction, observe its started and completed labels.
5. Switch to the short thread while the long thread is loading, then switch back. Refresh the page and repeat the check in light and dark themes.
6. For a thread without a readable local rollout, confirm the existing app-server load path still displays the conversation.
7. Open the duplicate-rollout thread and compare `GET /codex-api/thread-recent?threadId=...` with the `thread/list` rows and each file's first `session_meta` record.
8. On Windows and Linux, inspect `thread/resume` after a refresh: it must include `excludeTurns: true`. Load earlier messages before subsequent history detail finishes and confirm they remain after completion. On a disposable thread, submit a message during hydration and confirm `turn/start` waits for history detail, uses the restored model, and does not cause another resume.

#### Expected Results
- The initial fast response contains no more than 10 turns and no compaction summary body. Background resume completes without duplicate messages.
- Each earlier page adds at most 10 turns and preserves the viewport position. Historical compaction nodes appear on their corresponding page.
- Compaction is shown as a restrained timeline divider with a timestamp, including a visible in-progress label during live compaction. Both themes are legible.
- Switching or refreshing does not show stale content from another thread; unsupported logs fall back to the normal load.
- Duplicate rows map to the path with the greatest `updatedAt`, including when the older row arrives on a later page. A suffixed filename is accepted only when its canonical path remains under the sessions root and its first valid `session_meta.payload.id` matches the requested thread.
- Empty resume turns do not clear recent messages or their pagination marker. The existing send-after-hydration ordering is preserved; older runtimes returning turns still use that response. Historical commands, file changes, and compaction markers are hydrated through the existing detail/page endpoints.
- Metadata-only resume does not replace the server's last history snapshot or invalidate a cached/in-flight older-page read. A page already being loaded must not issue another full read solely because resume completed.

#### Rollback/Cleanup
- No persisted app state is changed by the check. Stop any test-only server; leave the regular development server running.
- Archive the disposable send-test thread after verification. Restore the original Plan mode. Revert the metadata-only resume change for rollback.
