### Feature: Recent thread fast open and context compaction markers

#### Prerequisites
- Run the app with a local Codex home containing a thread longer than 10 turns and at least one completed context compaction.
- Keep a second short thread available for switching.

#### Steps
1. Open the long thread with the Network panel visible. Inspect `GET /codex-api/thread-recent?threadId=...` and the subsequent `thread/resume` RPC.
2. Before the resume finishes, confirm the latest messages appear. Then wait for it to finish and check that messages are not duplicated or reordered.
3. Scroll to the top or press **Load earlier messages** repeatedly until the beginning of the thread. Inspect the earlier page requests and scroll position.
4. Find a completed context compaction in the timeline. Compare its time with the local rollout's `compacted` event. During a new compaction, observe its started and completed labels.
5. Switch to the short thread while the long thread is loading, then switch back. Refresh the page and repeat the check in light and dark themes.
6. For a thread without a readable local rollout, confirm the existing app-server load path still displays the conversation.

#### Expected Results
- The initial fast response contains no more than 10 turns and no compaction summary body. Background resume completes without duplicate messages.
- Each earlier page adds at most 10 turns and preserves the viewport position. Historical compaction nodes appear on their corresponding page.
- Compaction is shown as a restrained timeline divider with a timestamp, including a visible in-progress label during live compaction. Both themes are legible.
- Switching or refreshing does not show stale content from another thread; unsupported logs fall back to the normal load.

#### Rollback/Cleanup
- No persisted app state is changed by the check. Stop any test-only server; leave the regular development server running.
